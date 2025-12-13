import { expect } from "chai";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { ethers } from "hardhat";
import { CertificateRegistry } from "../typechain-types";

const ISSUE_TYPES = {
  Issue: [
    { name: "certificateId", type: "bytes32" },
    { name: "docHash", type: "bytes32" },
    { name: "storageURI", type: "string" },
    { name: "issuer", type: "address" },
    { name: "issuedAt", type: "uint256" },
    { name: "chainId", type: "uint256" },
    { name: "salt", type: "bytes16" },
  ],
};

async function deriveCertificateId(
  docHash: string,
  salt: string,
  issuer: string,
  chainId: bigint,
  issuedAt: bigint
): Promise<string> {
  const coder = ethers.AbiCoder.defaultAbiCoder();
  return ethers.keccak256(coder.encode(["bytes32", "bytes16", "address", "uint256", "uint64"], [docHash, salt, issuer, chainId, issuedAt]));
}

async function signIssue(
  registry: CertificateRegistry,
  signer: any,
  message: any
): Promise<string> {
  const domain = {
    name: "CertificateRegistry",
    version: "1",
    chainId: message.chainId,
    verifyingContract: registry.target as string,
  };
  return signer.signTypedData(domain, ISSUE_TYPES, message);
}

describe("CertificateRegistry", () => {
  const storageURI = "ipfs://cid/encrypted.pdf";
  let registry: CertificateRegistry;
  let owner: any;
  let issuer: any;
  let other: any;
  let chainId: bigint;

  beforeEach(async () => {
    [owner, issuer, other] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("CertificateRegistry");
    registry = (await Registry.deploy(owner.address)) as CertificateRegistry;
    chainId = (await ethers.provider.getNetwork()).chainId;
    await registry.addIssuer(issuer.address);
  });

  it("issues with valid signature and stores metadata", async () => {
    const docHash = ethers.keccak256(ethers.toUtf8Bytes("doc1"));
    const saltBytes = ethers.randomBytes(16);
    const salt = ethers.hexlify(saltBytes) as `0x${string}`;
    const issuedAt = BigInt(Math.floor(Date.now() / 1000));
    const certificateId = await deriveCertificateId(docHash, salt, issuer.address, chainId, issuedAt);

    const signature = await signIssue(registry, issuer, {
      certificateId,
      docHash,
      storageURI,
      issuer: issuer.address,
      issuedAt,
      chainId,
      salt,
    });

    await expect(
      registry.issueCertificate(certificateId, docHash, storageURI, issuer.address, issuedAt, salt, signature)
    )
      .to.emit(registry, "CertificateIssued")
      .withArgs(certificateId, issuer.address, docHash, storageURI, issuedAt, salt);

    const cert = await registry.getCertificate(certificateId);
    expect(cert.docHash).to.equal(docHash);
    expect(cert.storageURI).to.equal(storageURI);
    expect(cert.issuer).to.equal(issuer.address);
    expect(cert.issuedAt).to.equal(issuedAt);
    expect(cert.status).to.equal(1); // Active
    expect(cert.salt).to.equal(salt);
    expect(cert.issuerSignature).to.equal(signature);
  });

  it("rejects duplicate docHash+issuer", async () => {
    const docHash = ethers.keccak256(ethers.toUtf8Bytes("doc2"));
    const salt = ethers.hexlify(ethers.randomBytes(16)) as `0x${string}`;
    const issuedAt = BigInt(Math.floor(Date.now() / 1000));
    const certificateId = await deriveCertificateId(docHash, salt, issuer.address, chainId, issuedAt);
    const signature = await signIssue(registry, issuer, {
      certificateId,
      docHash,
      storageURI,
      issuer: issuer.address,
      issuedAt,
      chainId,
      salt,
    });

    await registry.issueCertificate(certificateId, docHash, storageURI, issuer.address, issuedAt, salt, signature);

    const salt2 = ethers.hexlify(ethers.randomBytes(16)) as `0x${string}`;
    const certificateId2 = await deriveCertificateId(docHash, salt2, issuer.address, chainId, issuedAt);
    const signature2 = await signIssue(registry, issuer, {
      certificateId: certificateId2,
      docHash,
      storageURI,
      issuer: issuer.address,
      issuedAt,
      chainId,
      salt: salt2,
    });

    await expect(
      registry.issueCertificate(certificateId2, docHash, storageURI, issuer.address, issuedAt, salt2, signature2)
    ).to.be.revertedWith("Duplicate docHash+issuer");
  });

  it("rejects invalid signature", async () => {
    const docHash = ethers.keccak256(ethers.toUtf8Bytes("doc3"));
    const salt = ethers.hexlify(ethers.randomBytes(16)) as `0x${string}`;
    const issuedAt = BigInt(Math.floor(Date.now() / 1000));
    const certificateId = await deriveCertificateId(docHash, salt, issuer.address, chainId, issuedAt);
    const signature = await signIssue(registry, other, {
      certificateId,
      docHash,
      storageURI,
      issuer: issuer.address,
      issuedAt,
      chainId,
      salt,
    });

    await expect(
      registry.issueCertificate(certificateId, docHash, storageURI, issuer.address, issuedAt, salt, signature)
    ).to.be.revertedWith("Invalid signature");
  });

  it("revokes by issuer with reason", async () => {
    const docHash = ethers.keccak256(ethers.toUtf8Bytes("doc4"));
    const salt = ethers.hexlify(ethers.randomBytes(16)) as `0x${string}`;
    const issuedAt = BigInt(Math.floor(Date.now() / 1000));
    const certificateId = await deriveCertificateId(docHash, salt, issuer.address, chainId, issuedAt);
    const signature = await signIssue(registry, issuer, {
      certificateId,
      docHash,
      storageURI,
      issuer: issuer.address,
      issuedAt,
      chainId,
      salt,
    });
    await registry.issueCertificate(certificateId, docHash, storageURI, issuer.address, issuedAt, salt, signature);

    const reason = "Expired";
    await expect(registry.connect(issuer).revokeCertificate(certificateId, reason))
      .to.emit(registry, "CertificateRevoked")
      .withArgs(certificateId, issuer.address, reason, anyValue);

    const cert = await registry.getCertificate(certificateId);
    expect(cert.status).to.equal(2); // Revoked
    expect(cert.revokeReason).to.equal(reason);
    expect(cert.revokedAt).to.be.greaterThan(0);
  });

  it("prevents revoke by unauthorized address", async () => {
    const docHash = ethers.keccak256(ethers.toUtf8Bytes("doc5"));
    const salt = ethers.hexlify(ethers.randomBytes(16)) as `0x${string}`;
    const issuedAt = BigInt(Math.floor(Date.now() / 1000));
    const certificateId = await deriveCertificateId(docHash, salt, issuer.address, chainId, issuedAt);
    const signature = await signIssue(registry, issuer, {
      certificateId,
      docHash,
      storageURI,
      issuer: issuer.address,
      issuedAt,
      chainId,
      salt,
    });
    await registry.issueCertificate(certificateId, docHash, storageURI, issuer.address, issuedAt, salt, signature);

    await expect(registry.connect(other).revokeCertificate(certificateId, "nope")).to.be.revertedWith("Not authorized");
  });
});
