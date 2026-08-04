// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IRiskEngine} from "./interfaces/IRiskEngine.sol";
import {IReserveLedger} from "./interfaces/IReserveLedger.sol";

/// @notice Holds Coston2-only rfUSD liquidity and the authoritative principal for each credit line.
contract CreditVault is AccessControl {
    uint256 public constant COSTON2_CHAIN_ID = 114;
    bytes32 public constant RISK_ADMIN_ROLE = keccak256("RISK_ADMIN_ROLE");

    struct CreditPosition {
        bytes32 reserveAccountId;
        uint256 principalWad;
        uint64 openedAt;
        uint64 lastRiskSyncAt;
        bool exists;
    }

    error UnsupportedChain(uint256 chainId);
    error ZeroAddress();
    error TokenAlreadySet();
    error TokenNotSet();
    error CreditLineAlreadyOpen(address borrower);
    error CreditLineNotOpen(address borrower);
    error UnauthorizedReserveAccount(bytes32 accountId, address borrower);
    error ZeroAmount();
    error BorrowingPaused();
    error CreditNotHealthy(IRiskEngine.RiskStatus status);
    error StalePrice();
    error StaleReserve();
    error AccountFrozen();
    error CreditLimitExceeded(uint256 creditLimitWad, uint256 requestedDebtWad);
    error ExcessRepayment(uint256 principalWad, uint256 repaymentWad);
    error InsufficientRfUsdAllowance(uint256 availableAllowance, uint256 requiredAmount);
    error InsufficientRfUsdBalance(uint256 availableBalance, uint256 requiredAmount);
    error RfUsdTransferFailed();
    error RepaymentRouterAlreadySet();
    error UnauthorizedRepaymentRouter(address caller);
    error RepaymentReserved(uint256 availableWad, uint256 requestedWad);

    event TokenConfigured(address indexed token);
    event CreditLineOpened(address indexed borrower, bytes32 indexed accountId, uint64 openedAt);
    event Borrowed(address indexed borrower, bytes32 indexed accountId, uint256 amountWad, uint256 principalWad, uint256 creditLimitWad);
    event Repaid(address indexed borrower, bytes32 indexed accountId, uint256 amountWad, uint256 principalWad);
    event BorrowingPausedUpdated(bool paused);
    event RiskSynced(address indexed borrower, bytes32 indexed accountId, IRiskEngine.RiskStatus status, uint64 syncedAt);
    event XrpRepaid(address indexed borrower, bytes32 indexed accountId, uint256 amountWad, uint256 principalWad);
    event RepaymentRouterConfigured(address indexed router);

    IReserveLedger public immutable reserveLedger;
    IRiskEngine public immutable riskEngine;
    IERC20 public token;
    address public repaymentRouter;
    bool public borrowingPaused;

    mapping(address borrower => CreditPosition position) private positions;
    mapping(address borrower => uint256 amountWad) public pendingXrpRepayments;

    constructor(address riskAdmin, IReserveLedger reserveLedger_, IRiskEngine riskEngine_) {
        if (block.chainid != COSTON2_CHAIN_ID) {
            revert UnsupportedChain(block.chainid);
        }
        if (riskAdmin == address(0) || address(reserveLedger_) == address(0) || address(riskEngine_) == address(0)) {
            revert ZeroAddress();
        }

        reserveLedger = reserveLedger_;
        riskEngine = riskEngine_;
        _grantRole(DEFAULT_ADMIN_ROLE, riskAdmin);
        _grantRole(RISK_ADMIN_ROLE, riskAdmin);
    }

    function setToken(IERC20 token_) external onlyRole(RISK_ADMIN_ROLE) {
        if (address(token_) == address(0)) {
            revert ZeroAddress();
        }
        if (address(token) != address(0)) {
            revert TokenAlreadySet();
        }

        token = token_;
        emit TokenConfigured(address(token_));
    }

    function setBorrowingPaused(bool paused) external onlyRole(RISK_ADMIN_ROLE) {
        borrowingPaused = paused;
        emit BorrowingPausedUpdated(paused);
    }

    function setRepaymentRouter(address router) external onlyRole(RISK_ADMIN_ROLE) {
        if (router == address(0)) revert ZeroAddress();
        if (repaymentRouter != address(0)) revert RepaymentRouterAlreadySet();
        repaymentRouter = router;
        emit RepaymentRouterConfigured(router);
    }

    function openCreditLine(bytes32 accountId) external {
        if (positions[msg.sender].exists) {
            revert CreditLineAlreadyOpen(msg.sender);
        }
        if (reserveLedger.getReserveAccount(accountId).borrower != msg.sender) {
            revert UnauthorizedReserveAccount(accountId, msg.sender);
        }

        positions[msg.sender] = CreditPosition({
            reserveAccountId: accountId,
            principalWad: 0,
            openedAt: uint64(block.timestamp),
            lastRiskSyncAt: 0,
            exists: true
        });
        emit CreditLineOpened(msg.sender, accountId, uint64(block.timestamp));
    }

    function borrow(uint256 amountWad) external {
        if (amountWad == 0) {
            revert ZeroAmount();
        }
        if (borrowingPaused) {
            revert BorrowingPaused();
        }
        if (address(token) == address(0)) {
            revert TokenNotSet();
        }

        CreditPosition storage position = _position(msg.sender);
        IRiskEngine.RiskSnapshot memory snapshot = riskEngine.getRiskSnapshot(position.reserveAccountId, position.principalWad);
        _requireBorrowable(snapshot.status);

        uint256 requestedDebtWad = position.principalWad + amountWad;
        if (requestedDebtWad > snapshot.creditLimitWad) {
            revert CreditLimitExceeded(snapshot.creditLimitWad, requestedDebtWad);
        }
        if (!token.transfer(msg.sender, amountWad)) {
            revert RfUsdTransferFailed();
        }

        position.principalWad = requestedDebtWad;
        position.lastRiskSyncAt = uint64(block.timestamp);
        emit Borrowed(msg.sender, position.reserveAccountId, amountWad, requestedDebtWad, snapshot.creditLimitWad);
    }

    function repay(uint256 amountWad) external {
        if (amountWad == 0) {
            revert ZeroAmount();
        }
        if (address(token) == address(0)) {
            revert TokenNotSet();
        }

        CreditPosition storage position = _position(msg.sender);
        if (amountWad > position.principalWad) {
            revert ExcessRepayment(position.principalWad, amountWad);
        }
        uint256 availableForRfUsdRepayment = position.principalWad - pendingXrpRepayments[msg.sender];
        if (amountWad > availableForRfUsdRepayment) {
            revert RepaymentReserved(availableForRfUsdRepayment, amountWad);
        }
        uint256 allowance = token.allowance(msg.sender, address(this));
        if (allowance < amountWad) {
            revert InsufficientRfUsdAllowance(allowance, amountWad);
        }
        uint256 balance = token.balanceOf(msg.sender);
        if (balance < amountWad) {
            revert InsufficientRfUsdBalance(balance, amountWad);
        }
        if (!token.transferFrom(msg.sender, address(this), amountWad)) {
            revert RfUsdTransferFailed();
        }

        position.principalWad -= amountWad;
        position.lastRiskSyncAt = uint64(block.timestamp);
        emit Repaid(msg.sender, position.reserveAccountId, amountWad, position.principalWad);
    }

    function syncRisk() external {
        CreditPosition storage position = _position(msg.sender);
        IRiskEngine.RiskSnapshot memory snapshot = riskEngine.getRiskSnapshot(position.reserveAccountId, position.principalWad);
        position.lastRiskSyncAt = uint64(block.timestamp);
        emit RiskSynced(msg.sender, position.reserveAccountId, snapshot.status, uint64(block.timestamp));
    }

    /// @notice Decreases principal after XrpRepaymentRouter has verified an FDC XRPL payment.
    function settleXrpRepayment(address borrower, uint256 amountWad) external {
        if (msg.sender != repaymentRouter) revert UnauthorizedRepaymentRouter(msg.sender);
        if (amountWad == 0) revert ZeroAmount();
        CreditPosition storage position = _position(borrower);
        if (amountWad > pendingXrpRepayments[borrower]) {
            revert RepaymentReserved(pendingXrpRepayments[borrower], amountWad);
        }
        if (amountWad > position.principalWad) revert ExcessRepayment(position.principalWad, amountWad);
        pendingXrpRepayments[borrower] -= amountWad;
        position.principalWad -= amountWad;
        position.lastRiskSyncAt = uint64(block.timestamp);
        emit XrpRepaid(borrower, position.reserveAccountId, amountWad, position.principalWad);
    }

    function reserveXrpRepayment(address borrower, uint256 amountWad) external {
        if (msg.sender != repaymentRouter) revert UnauthorizedRepaymentRouter(msg.sender);
        CreditPosition storage position = _position(borrower);
        uint256 available = position.principalWad - pendingXrpRepayments[borrower];
        if (amountWad == 0 || amountWad > available) revert RepaymentReserved(available, amountWad);
        pendingXrpRepayments[borrower] += amountWad;
    }

    function releaseXrpRepayment(address borrower, uint256 amountWad) external {
        if (msg.sender != repaymentRouter) revert UnauthorizedRepaymentRouter(msg.sender);
        if (amountWad > pendingXrpRepayments[borrower]) {
            revert RepaymentReserved(pendingXrpRepayments[borrower], amountWad);
        }
        pendingXrpRepayments[borrower] -= amountWad;
    }

    function getPosition(address borrower) external view returns (CreditPosition memory) {
        return _position(borrower);
    }

    function _position(address borrower) private view returns (CreditPosition storage position) {
        position = positions[borrower];
        if (!position.exists) {
            revert CreditLineNotOpen(borrower);
        }
    }

    function _requireBorrowable(IRiskEngine.RiskStatus status) private pure {
        if (status == IRiskEngine.RiskStatus.HEALTHY) {
            return;
        }
        if (status == IRiskEngine.RiskStatus.PRICE_STALE) {
            revert StalePrice();
        }
        if (status == IRiskEngine.RiskStatus.RESERVE_STALE) {
            revert StaleReserve();
        }
        if (status == IRiskEngine.RiskStatus.FROZEN) {
            revert AccountFrozen();
        }
        revert CreditNotHealthy(status);
    }
}
