import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  console.log("Deploying with:", deployer.address);
  console.log("Network:", network.name, "chainId:", network.chainId.toString());

  // Optional fee overrides via env (gwei)
  const maxFeeGwei = process.env.MAX_FEE_GWEI;
  const maxPriorityFeeGwei = process.env.MAX_PRIORITY_FEE_GWEI;
  const overrides: any = {};
  if (maxFeeGwei) overrides.maxFeePerGas = ethers.parseUnits(maxFeeGwei, "gwei");
  if (maxPriorityFeeGwei) overrides.maxPriorityFeePerGas = ethers.parseUnits(maxPriorityFeeGwei, "gwei");

  const Registry = await ethers.getContractFactory("CertificateRegistry");
  const registry = await Registry.deploy(deployer.address, overrides);
  const tx = registry.deploymentTransaction();
  console.log("Deployment tx hash:", tx?.hash);

  const receipt = await tx?.wait();
  console.log("Tx status:", receipt?.status, "gasUsed:", receipt?.gasUsed?.toString());

  const address = receipt?.contractAddress || (await registry.getAddress());
  console.log("CertificateRegistry deployed to:", address);
  console.log("Owner set to:", await registry.owner());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
