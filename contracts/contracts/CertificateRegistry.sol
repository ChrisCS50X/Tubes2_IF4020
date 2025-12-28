// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract CertificateRegistry is EIP712, Ownable, ReentrancyGuard {
    using ECDSA for bytes32;

    enum Status {
        None,
        Active,
        Revoked
    }

    struct Certificate {
        bytes32 docHash; // SHA-256 hash of unsigned PDF
        string storageURI; // IPFS CID / gateway URL to encrypted PDF
        address issuer; // issuer address (must be authorized)
        uint64 issuedAt; // timestamp declared in the signed payload
        Status status; // lifecycle status
        string revokeReason; // bounded in revoke
        uint64 revokedAt; // timestamp when revoked
        bytes issuerSignature; // EIP-712 signature from issuer
        bytes16 salt; // 128-bit random salt (used to derive certificateId)     
        bytes revokeSignature; // EIP-712 signature for revoke (issuer)
    }

    bytes32 private constant ISSUE_TYPEHASH =
        keccak256(
            "Issue(bytes32 certificateId,bytes32 docHash,string storageURI,address issuer,uint256 issuedAt,uint256 chainId,bytes16 salt)"
        );
    bytes32 private constant REVOKE_TYPEHASH =
        keccak256(
            "Revoke(bytes32 certificateId,string reason,address issuer,uint256 chainId)"
        );

    mapping(bytes32 => Certificate) private certificates;
    mapping(bytes32 => bool) private issuedByDocAndIssuer; // keccak256(docHash, issuer) to prevent duplicate issuance
    mapping(address => bool) public isAuthorizedIssuer;

    // Track issuer list for UI / enumeration
    address[] private issuerList;
    mapping(address => uint256) private issuerIndexPlusOne; // 1-based index into issuerList

    // Multi-sig style issuer update proposals (managed by institution/owner, approved by issuers)
    enum IssuerUpdateAction {
        None,
        Add,
        Rotate
    }

    struct IssuerUpdateProposal {
        IssuerUpdateAction action;
        address issuer; // for Rotate: current issuer address; for Add: unused (0)
        address newIssuer; // for Add/Rotate: the new issuer address
        uint32 approvals;
        bool executed;
        uint64 createdAt;
    }

    uint256 public issuerUpdateThreshold = 1;
    uint256 public nextIssuerUpdateProposalId = 1;
    mapping(uint256 => IssuerUpdateProposal) public issuerUpdateProposals;
    mapping(uint256 => mapping(address => bool)) private issuerUpdateApprovedBy;

    event CertificateIssued(
        bytes32 indexed certificateId,
        address indexed issuer,
        bytes32 docHash,
        string storageURI,
        uint64 issuedAt,
        bytes16 salt
    );
    event CertificateRevoked(bytes32 indexed certificateId, address indexed issuer, string reason, uint64 revokedAt);
    event IssuerUpdated(address indexed issuer, bool authorized);

    event IssuerUpdateThresholdUpdated(uint256 threshold);
    event IssuerUpdateProposed(
        uint256 indexed proposalId,
        IssuerUpdateAction action,
        address indexed issuer,
        address indexed newIssuer,
        uint64 createdAt
    );
    event IssuerUpdateApproved(uint256 indexed proposalId, address indexed approver, uint32 approvals);
    event IssuerUpdateExecuted(uint256 indexed proposalId, IssuerUpdateAction action, address issuer, address newIssuer);

    constructor(address initialOwner) EIP712("CertificateRegistry", "1") Ownable(initialOwner) {}

    modifier onlyIssuerOrOwner(address issuer) {
        require(msg.sender == owner() || msg.sender == issuer, "Not issuer/owner");
        _;
    }

    modifier onlyAuthorizedIssuer() {
        require(isAuthorizedIssuer[msg.sender], "Issuer not authorized");
        _;
    }

    function getIssuers() external view returns (address[] memory) {
        return issuerList;
    }

    function hasApprovedIssuerUpdate(uint256 proposalId, address approver) external view returns (bool) {
        return issuerUpdateApprovedBy[proposalId][approver];
    }

    /// @notice Owner configures approvals required for issuer updates.
    function setIssuerUpdateThreshold(uint256 threshold) external onlyOwner {
        require(threshold > 0, "Threshold zero");
        issuerUpdateThreshold = threshold;
        emit IssuerUpdateThresholdUpdated(threshold);
    }

    /// @notice Owner adds an issuer to the whitelist.
    function addIssuer(address issuer) external onlyOwner {
        require(issuer != address(0), "Issuer zero");
        require(!isAuthorizedIssuer[issuer], "Already issuer");
        isAuthorizedIssuer[issuer] = true;

        issuerList.push(issuer);
        issuerIndexPlusOne[issuer] = issuerList.length;

        emit IssuerUpdated(issuer, true);
    }

    /// @notice Owner removes an issuer from the whitelist.
    function removeIssuer(address issuer) external onlyOwner {
        require(isAuthorizedIssuer[issuer], "Not issuer");
        isAuthorizedIssuer[issuer] = false;

        uint256 idxPlusOne = issuerIndexPlusOne[issuer];
        if (idxPlusOne != 0) {
            uint256 idx = idxPlusOne - 1;
            uint256 lastIdx = issuerList.length - 1;
            if (idx != lastIdx) {
                address lastIssuer = issuerList[lastIdx];
                issuerList[idx] = lastIssuer;
                issuerIndexPlusOne[lastIssuer] = idx + 1;
            }
            issuerList.pop();
            issuerIndexPlusOne[issuer] = 0;
        }

        emit IssuerUpdated(issuer, false);
    }

    /// @notice Owner proposes adding a new issuer (requires approvals from authorized issuers).
    function proposeAddIssuer(address newIssuer) external onlyOwner returns (uint256 proposalId) {
        require(newIssuer != address(0), "Issuer zero");
        require(!isAuthorizedIssuer[newIssuer], "Already issuer");

        proposalId = nextIssuerUpdateProposalId++;
        issuerUpdateProposals[proposalId] = IssuerUpdateProposal({
            action: IssuerUpdateAction.Add,
            issuer: address(0),
            newIssuer: newIssuer,
            approvals: 0,
            executed: false,
            createdAt: uint64(block.timestamp)
        });

        emit IssuerUpdateProposed(proposalId, IssuerUpdateAction.Add, address(0), newIssuer, uint64(block.timestamp));
    }

    /// @notice Owner proposes rotating an issuer key (old issuer removed, new issuer added).
    function proposeRotateIssuer(address issuer, address newIssuer) external onlyOwner returns (uint256 proposalId) {
        require(isAuthorizedIssuer[issuer], "Not issuer");
        require(newIssuer != address(0), "Issuer zero");
        require(!isAuthorizedIssuer[newIssuer], "Already issuer");
        require(issuer != newIssuer, "Same issuer");

        proposalId = nextIssuerUpdateProposalId++;
        issuerUpdateProposals[proposalId] = IssuerUpdateProposal({
            action: IssuerUpdateAction.Rotate,
            issuer: issuer,
            newIssuer: newIssuer,
            approvals: 0,
            executed: false,
            createdAt: uint64(block.timestamp)
        });

        emit IssuerUpdateProposed(proposalId, IssuerUpdateAction.Rotate, issuer, newIssuer, uint64(block.timestamp));
    }

    /// @notice Authorized issuer approves a pending update proposal.
    function approveIssuerUpdate(uint256 proposalId) external onlyAuthorizedIssuer {
        IssuerUpdateProposal storage p = issuerUpdateProposals[proposalId];
        require(p.action != IssuerUpdateAction.None, "Proposal missing");
        require(!p.executed, "Already executed");
        require(!issuerUpdateApprovedBy[proposalId][msg.sender], "Already approved");

        issuerUpdateApprovedBy[proposalId][msg.sender] = true;
        p.approvals += 1;

        emit IssuerUpdateApproved(proposalId, msg.sender, p.approvals);
    }

    /// @notice Owner executes an approved update proposal.
    function executeIssuerUpdate(uint256 proposalId) external onlyOwner {
        IssuerUpdateProposal storage p = issuerUpdateProposals[proposalId];
        require(p.action != IssuerUpdateAction.None, "Proposal missing");
        require(!p.executed, "Already executed");
        require(p.approvals >= issuerUpdateThreshold, "Insufficient approvals");

        p.executed = true;

        if (p.action == IssuerUpdateAction.Add) {
            // reuse checks even if state changed since proposal
            require(p.newIssuer != address(0), "Issuer zero");
            require(!isAuthorizedIssuer[p.newIssuer], "Already issuer");
            isAuthorizedIssuer[p.newIssuer] = true;
            issuerList.push(p.newIssuer);
            issuerIndexPlusOne[p.newIssuer] = issuerList.length;
            emit IssuerUpdated(p.newIssuer, true);
        } else if (p.action == IssuerUpdateAction.Rotate) {
            require(isAuthorizedIssuer[p.issuer], "Not issuer");
            require(p.newIssuer != address(0), "Issuer zero");
            require(!isAuthorizedIssuer[p.newIssuer], "Already issuer");

            // remove old
            isAuthorizedIssuer[p.issuer] = false;
            {
                uint256 idxPlusOne = issuerIndexPlusOne[p.issuer];
                if (idxPlusOne != 0) {
                    uint256 idx = idxPlusOne - 1;
                    uint256 lastIdx = issuerList.length - 1;
                    if (idx != lastIdx) {
                        address lastIssuer = issuerList[lastIdx];
                        issuerList[idx] = lastIssuer;
                        issuerIndexPlusOne[lastIssuer] = idx + 1;
                    }
                    issuerList.pop();
                    issuerIndexPlusOne[p.issuer] = 0;
                }
            }
            emit IssuerUpdated(p.issuer, false);

            // add new
            isAuthorizedIssuer[p.newIssuer] = true;
            issuerList.push(p.newIssuer);
            issuerIndexPlusOne[p.newIssuer] = issuerList.length;
            emit IssuerUpdated(p.newIssuer, true);
        }

        emit IssuerUpdateExecuted(proposalId, p.action, p.issuer, p.newIssuer);
    }

    /// @notice Issue a new certificate. Signature must be produced by the issuer over the typed data.
    function issueCertificate(
        bytes32 certificateId,
        bytes32 docHash,
        string calldata storageURI,
        address issuer,
        uint64 issuedAt,
        bytes16 salt,
        bytes calldata issuerSignature
    ) external nonReentrant {
        require(isAuthorizedIssuer[issuer], "Issuer not authorized");
        require(certificates[certificateId].status == Status.None, "Certificate exists");
        require(bytes(storageURI).length > 0, "storageURI empty");
        require(issuedAt > 0, "issuedAt zero");

        bytes32 docIssuerKey = keccak256(abi.encodePacked(docHash, issuer));
        require(!issuedByDocAndIssuer[docIssuerKey], "Duplicate docHash+issuer");

        // Recompute certificateId to enforce the derivation rule off-chain.
        bytes32 expectedId = keccak256(abi.encode(docHash, salt, issuer, block.chainid, issuedAt));
        require(expectedId == certificateId, "certificateId mismatch");

        address signer = _recoverIssueSigner(
            certificateId,
            docHash,
            storageURI,
            issuer,
            issuedAt,
            salt,
            issuerSignature
        );
        require(signer == issuer, "Invalid signature");

        certificates[certificateId] = Certificate({
            docHash: docHash,
            storageURI: storageURI,
            issuer: issuer,
            issuedAt: issuedAt,
            status: Status.Active,
            revokeReason: "",
            revokedAt: 0,
            issuerSignature: issuerSignature,
            salt: salt,
            revokeSignature: ""
        });

        issuedByDocAndIssuer[docIssuerKey] = true;

        emit CertificateIssued(certificateId, issuer, docHash, storageURI, issuedAt, salt);
    }

    /// @notice Revoke an active certificate. Only owner or the original issuer can revoke.
    function revokeCertificate(
        bytes32 certificateId,
        string calldata reason,
        bytes calldata issuerSignature
    ) external nonReentrant {
        Certificate storage cert = certificates[certificateId];
        require(cert.status == Status.Active, "Not active");
        require(msg.sender == owner() || msg.sender == cert.issuer, "Not authorized");
        uint256 reasonLen = bytes(reason).length;
        require(reasonLen > 0, "Reason required");
        require(reasonLen <= 256, "Reason too long");
        require(issuerSignature.length > 0, "Signature required");

        address signer = _recoverRevokeSigner(certificateId, reason, cert.issuer, issuerSignature);
        require(signer == cert.issuer, "Invalid revoke signature");

        cert.status = Status.Revoked;
        cert.revokeReason = reason;
        cert.revokedAt = uint64(block.timestamp);
        cert.revokeSignature = issuerSignature;

        emit CertificateRevoked(certificateId, cert.issuer, reason, cert.revokedAt);
    }

    /// @notice Fetch certificate metadata by id.
    function getCertificate(bytes32 certificateId) external view returns (Certificate memory) {
        return certificates[certificateId];
    }

    /// @notice Check status of a certificate id.
    function certificateStatus(bytes32 certificateId) external view returns (Status) {
        return certificates[certificateId].status;
    }

    function _recoverIssueSigner(
        bytes32 certificateId,
        bytes32 docHash,
        string calldata storageURI,
        address issuer,
        uint64 issuedAt,
        bytes16 salt,
        bytes calldata issuerSignature
    ) internal view returns (address) {
        bytes32 structHash = keccak256(
            abi.encode(
                ISSUE_TYPEHASH,
                certificateId,
                docHash,
                keccak256(bytes(storageURI)),
                issuer,
                uint256(issuedAt),
                block.chainid,
                salt
            )
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        return ECDSA.recover(digest, issuerSignature);
    }

    function _recoverRevokeSigner(
        bytes32 certificateId,
        string calldata reason,
        address issuer,
        bytes calldata issuerSignature
    ) internal view returns (address) {
        bytes32 structHash = keccak256(
            abi.encode(
                REVOKE_TYPEHASH,
                certificateId,
                keccak256(bytes(reason)),
                issuer,
                block.chainid
            )
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        return ECDSA.recover(digest, issuerSignature);
    }
}
