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
    }

    bytes32 private constant ISSUE_TYPEHASH =
        keccak256(
            "Issue(bytes32 certificateId,bytes32 docHash,string storageURI,address issuer,uint256 issuedAt,uint256 chainId,bytes16 salt)"
        );

    mapping(bytes32 => Certificate) private certificates;
    mapping(bytes32 => bool) private issuedByDocAndIssuer; // keccak256(docHash, issuer) to prevent duplicate issuance
    mapping(address => bool) public isAuthorizedIssuer;

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

    constructor(address initialOwner) EIP712("CertificateRegistry", "1") Ownable(initialOwner) {}

    modifier onlyIssuerOrOwner(address issuer) {
        require(msg.sender == owner() || msg.sender == issuer, "Not issuer/owner");
        _;
    }

    /// @notice Owner adds an issuer to the whitelist.
    function addIssuer(address issuer) external onlyOwner {
        require(issuer != address(0), "Issuer zero");
        require(!isAuthorizedIssuer[issuer], "Already issuer");
        isAuthorizedIssuer[issuer] = true;
        emit IssuerUpdated(issuer, true);
    }

    /// @notice Owner removes an issuer from the whitelist.
    function removeIssuer(address issuer) external onlyOwner {
        require(isAuthorizedIssuer[issuer], "Not issuer");
        isAuthorizedIssuer[issuer] = false;
        emit IssuerUpdated(issuer, false);
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
            salt: salt
        });

        issuedByDocAndIssuer[docIssuerKey] = true;

        emit CertificateIssued(certificateId, issuer, docHash, storageURI, issuedAt, salt);
    }

    /// @notice Revoke an active certificate. Only owner or the original issuer can revoke.
    function revokeCertificate(bytes32 certificateId, string calldata reason) external nonReentrant {
        Certificate storage cert = certificates[certificateId];
        require(cert.status == Status.Active, "Not active");
        require(msg.sender == owner() || msg.sender == cert.issuer, "Not authorized");
        uint256 reasonLen = bytes(reason).length;
        require(reasonLen > 0, "Reason required");
        require(reasonLen <= 256, "Reason too long");

        cert.status = Status.Revoked;
        cert.revokeReason = reason;
        cert.revokedAt = uint64(block.timestamp);

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
}
