# Sistem Pencatatan Ijazah Digital Berbasis *Blockchain* atau *Centralized Immutable Ledger*

> Maraknya ijazah palsu menuntut sistem pencatatan ijazah yang transparan. Blockchain dapat dimanfaatkan dengan ijazah digital yang ditandatangani rektor menggunakan kriptografi kunci publik dan fungsi hash.

## Deskripsi Proyek

Proyek ini merupakan implementasi **Sistem Pencatatan Ijazah Digital** berbasis **blockchain** atau **centralized immutable ledger** untuk menjamin keaslian dan integritas ijazah digital. Sistem dirancang untuk mengatasi pemalsuan ijazah dengan menyediakan mekanisme penerbitan, penyimpanan, pencabutan, dan verifikasi ijazah yang transparan dan tidak dapat diubah.

Ijazah diterbitkan oleh **Admin Institusi** dalam bentuk dokumen digital (PDF, gambar, atau teks) yang di-hash menggunakan **SHA-256** dan ditandatangani secara digital menggunakan **ECDSA**. Dokumen ijazah disimpan secara **off-chain** dalam keadaan terenkripsi menggunakan **AES**, sementara metadata ijazah dicatat pada ledger untuk menjaga efisiensi dan privasi.

Sistem mendukung dua transaksi utama, yaitu **Issue Certificate** dan **Revoke Certificate**. Publik dapat melakukan verifikasi keaslian ijazah melalui website dengan memanfaatkan transparansi dan sifat immutable dari ledger. Autentikasi Admin Institusi dilakukan menggunakan mekanisme kriptografi berbasis **signature nonce challenge**.

## Daftar Fungsi

### 1) Autentikasi Admin (Institusi)
- **generateNonce(address)**  
	Membuat nonce acak untuk proses login Admin berbasis wallet.  
	(web/src/lib/nonce.ts)

- **loginMessage(nonce)**  
	Membuat pesan login yang harus ditandatangani wallet.  
	(web/src/lib/messages.ts)

- **Verifikasi Signature Login**  
	Signature nonce diverifikasi di backend (API route auth/verify/route.ts).

### 2) Pembuatan & Pemrosesan Ijazah
- **generateCertificatePDF(data)**  
	Membentuk dokumen ijazah (PDF) dari data input.  
	(web/src/lib/pdf/generateCertificate.ts)

- **sha256(fileBytes)**  
	Menghitung hash dokumen ijazah menggunakan SHA-256.  
	(web/src/lib/crypto/hash.ts)

- **createIssueTypedData(data), signTypedData(...)**  
	Menyiapkan dan menandatangani data ijazah secara digital (ECDSA, EIP-712).  
	(web/src/lib/eip712.ts)

### 3) Enkripsi & Penyimpanan Off-chain
- **generateAesKey()**  
	Membuat kunci AES untuk enkripsi dokumen ijazah.  
	(web/src/lib/crypto/aes.ts)

- **encryptAesGcm(key, data), decryptAesGcm(key, payload)**  
	Mengenkripsi dan mendekripsi dokumen ijazah menggunakan AES-GCM.  
	(web/src/lib/crypto/aes.ts)

- **pinFile(name, content, mimeType)**  
	Mengunggah file terenkripsi ke IPFS (off-chain storage) dan mengembalikan CID.  
	(web/src/lib/ipfs/pinata.ts)

### 4) Interaksi Smart Contract (On-chain)
- **getCertificateRegistry(signerOrProvider)**  
	Mendapatkan instance smart contract CertificateRegistry.  
	(web/src/lib/contract.ts)

- **issueCertificate(...)**  
	Fungsi smart contract untuk mencatat metadata ijazah ke blockchain.  
	(contracts/contracts/CertificateRegistry.sol)

- **revokeCertificate(...)**  
	Fungsi smart contract untuk mencabut ijazah.  
	(contracts/contracts/CertificateRegistry.sol)

## Cara Menjalankan Program
### 0. Konfigurasi Environment (.env)

Sebelum menjalankan aplikasi, pastikan sudah membuat file `.env` pada masing-masing folder berikut:

#### a. Folder `contracts`

Tambahkan variabel berikut ke file `contracts/.env`:

```env
ALCHEMY_API_URL=https://eth-sepolia.g.alchemy.com/v2/EE-q9pXO02LXVEySEaHLq
SEPOLIA_PRIVATE_KEY=a91cde209dcf76cbd9755a30162ed8e413fbc675dd8f1d4ebedcb5943233630a
ETHERSCAN_API_KEY=DKSFX65FRETZSH1TBA4T9714I9WTX989PS
```

#### b. Folder `web`

Tambahkan variabel berikut ke file `web/.env`:

```env
NEXT_PUBLIC_CONTRACT_ADDRESS=0x5115bBA0c7bc89f862C867DFE2bdF3C664e606fE
NEXT_PUBLIC_CHAIN_ID=11155111
NEXT_PUBLIC_ALCHEMY_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/EE-q9pXO02LXVEySEaHLq

PINATA_JWT=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySW5mb3JtYXRpb24iOnsiaWQiOiJmODU0ZjVhZS01Y2JjLTRiYmItOGU5My0wNTU0NTNhYTFkZmIiLCJlbWFpbCI6ImNocmlzdGlhbi5qdXN0aW4yM0BnbWFpbC5jb20iLCJlbWFpbF92ZXJpZmllZCI6dHJ1ZSwicGluX3BvbGljeSI6eyJyZWdpb25zIjpbeyJkZXNpcmVkUmVwbGljYXRpb25Db3VudCI6MSwiaWQiOiJGUkExIn0seyJkZXNpcmVkUmVwbGljYXRpb25Db3VudCI6MSwiaWQiOiJOWUMxIn1dLCJ2ZXJzaW9uIjoxfSwibWZhX2VuYWJsZWQiOmZhbHNlLCJzdGF0dXMiOiJBQ1RJVkUifSwiYXV0aGVudGljYXRpb25UeXBlIjoic2NvcGVkS2V5Iiwic2NvcGVkS2V5S2V5IjoiMWU0NjkwYzM1NjBlNjA5N2E5YTYiLCJzY29wZWRLZXlTZWNyZXQiOiI2ZTViZDg3ZmMzNTVlMGUwYmM0ZGY3NzAxYmVkNjZjMzhlMjViNjRkZmY5Nzg3M2FhZDYwNmIwOWFiNDAzYzU1IiwiZXhwIjoxNzk2ODk5NTgyfQ.TLFpgIGSpVFNKR3s-aNjhDupJywK3ECugxf8Y9yWydc
PINATA_API_KEY=1e4690c3560e6097a9a6
PINATA_API_SECRET=6e5bd87fc355e0e0bc4df7701bed66c38e25b64dff97873aad606b09ab403c55

SESSION_SECRET=6e5bd87fc355e0e0bc4df7701bed66c38e25b64dff97873aad606b09ab403c55
```

### 1. Menjalankan Web/Frontend

Masuk ke folder web:

```bash
cd web
```

Install dependencies:

```bash
npm install
npm i --save-dev @types/qrcode
```

Jalankan aplikasi:

```bash
npm run dev
```

Aplikasi akan berjalan di http://localhost:6173.

### 2. Smart Contracts

- Folder `contracts` berisi kode smart contract dan script deployment.
- **tidak perlu menjalankan ulang** bagian ini kecuali ada perubahan pada smart contract.
- Jika perubahan dilakukan pada smart contract, lakukan deploy ulang dengan perintah berikut (dari dalam folder `contracts`):

```bash
npx hardhat run scripts/deploy.ts --network sepolia
```

