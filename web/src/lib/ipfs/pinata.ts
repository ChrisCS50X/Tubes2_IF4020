import pinataSDK from "@pinata/sdk";

const PINATA_JWT = process.env.PINATA_JWT;
const PINATA_API_KEY = process.env.PINATA_API_KEY;
const PINATA_API_SECRET = process.env.PINATA_API_SECRET;

if (!PINATA_JWT && !(PINATA_API_KEY && PINATA_API_SECRET)) {
  throw new Error("Pinata credentials missing. Provide PINATA_JWT or API key/secret");
}

const pinata = PINATA_JWT
  ? new (pinataSDK as any)({ pinataJWTKey: PINATA_JWT })
  : new (pinataSDK as any)({ pinataApiKey: PINATA_API_KEY, pinataSecretApiKey: PINATA_API_SECRET });

export async function pinFile(name: string, content: Buffer, mimeType: string) {
  const options = {
    pinataMetadata: { name },
    pinataOptions: { cidVersion: 1 },
  };
  const result = await pinata.pinFileToIPFS(toReadable(content, mimeType), options);
  return {
    cid: result.IpfsHash,
    size: result.PinSize,
  };
}

function toReadable(buffer: Buffer, mimeType: string) {
  const { Readable } = require("stream");
  const stream = new Readable();
  stream.push(buffer);
  stream.push(null);
  // pinFileToIPFS will infer mime from filename; here we just send bytes
  stream.path = `file.${extFromMime(mimeType)}`;
  return stream;
}

function extFromMime(mime: string) {
  if (mime.includes("pdf")) return "pdf";
  if (mime.includes("png")) return "png";
  if (mime.includes("jpg") || mime.includes("jpeg")) return "jpg";
  if (mime.includes("txt")) return "txt";
  return "bin";
}
