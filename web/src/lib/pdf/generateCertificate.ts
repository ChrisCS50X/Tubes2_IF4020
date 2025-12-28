import { jsPDF } from "jspdf";
import "jspdf-autotable";

export type CertificateData = {
  studentName: string;
  nim: string;
  program: string;
  faculty: string;
  graduationDate: string;
  gpa: string;
  degree: string;
  universityName?: string;
  rectorName?: string;
  deanName?: string;
};

/**
 * Generate PDF certificate with elegant design
 * Returns the PDF as an ArrayBuffer
 */
export async function generateCertificatePDF(data: CertificateData): Promise<ArrayBuffer> {
  const doc = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format: "a4",
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  // University name and info
  const universityName = data.universityName || "INSTITUT TEKNOLOGI BANDUNG";
  const rectorName = data.rectorName || "Prof. Dr. Rektor ITB";
  const deanName = data.deanName || "Dr. Dekan STEI";

  // ========== BACKGROUND & BORDER ==========
  // Outer border (gold)
  doc.setDrawColor(184, 134, 11); // Dark goldenrod
  doc.setLineWidth(2);
  doc.rect(10, 10, pageWidth - 20, pageHeight - 20);

  // Inner border (light gold)
  doc.setDrawColor(218, 165, 32); // Goldenrod
  doc.setLineWidth(0.5);
  doc.rect(15, 15, pageWidth - 30, pageHeight - 30);

  // Decorative corners
  addCornerDecorations(doc, pageWidth, pageHeight);

  // ========== HEADER ==========
  doc.setFontSize(24);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(0, 51, 102); // Dark blue
  doc.text(universityName, pageWidth / 2, 35, { align: "center" });

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(80, 80, 80);
  doc.text(data.faculty, pageWidth / 2, 42, { align: "center" });

  // ========== CERTIFICATE TITLE ==========
  doc.setFontSize(32);
  doc.setFont("times", "bold");
  doc.setTextColor(139, 0, 0); // Dark red
  doc.text("IJAZAH", pageWidth / 2, 60, { align: "center" });

  doc.setFontSize(16);
  doc.setFont("times", "italic");
  doc.setTextColor(100, 100, 100);
  doc.text(`Sarjana ${data.degree}`, pageWidth / 2, 68, { align: "center" });

  // ========== DECORATIVE LINE ==========
  doc.setDrawColor(184, 134, 11);
  doc.setLineWidth(1);
  doc.line(60, 75, pageWidth - 60, 75);

  // ========== CERTIFICATE TEXT ==========
  doc.setFontSize(12);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(40, 40, 40);
  doc.text("Dengan ini menerangkan bahwa:", pageWidth / 2, 88, { align: "center" });

  // Student Name (highlighted)
  doc.setFontSize(22);
  doc.setFont("times", "bold");
  doc.setTextColor(0, 51, 102);
  doc.text(data.studentName.toUpperCase(), pageWidth / 2, 100, { align: "center" });

  // NIM
  doc.setFontSize(12);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(80, 80, 80);
  doc.text(`NIM: ${data.nim}`, pageWidth / 2, 108, { align: "center" });

  // Program
  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(40, 40, 40);
  doc.text(`Program Studi: ${data.program}`, pageWidth / 2, 118, { align: "center" });

  // Achievement text
  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  const achievementText = `telah menyelesaikan seluruh persyaratan akademik dengan prestasi memuaskan`;
  doc.text(achievementText, pageWidth / 2, 128, { align: "center" });
  
  doc.text(`dan berhak menyandang gelar Sarjana ${data.degree}`, pageWidth / 2, 135, { align: "center" });

  // ========== GPA BOX ==========
  const gpaBoxX = pageWidth / 2 - 30;
  const gpaBoxY = 143;
  doc.setFillColor(240, 248, 255); // Alice blue
  doc.setDrawColor(184, 134, 11);
  doc.setLineWidth(0.5);
  doc.roundedRect(gpaBoxX, gpaBoxY, 60, 12, 2, 2, "FD");

  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(0, 51, 102);
  doc.text(`IPK: ${data.gpa}`, pageWidth / 2, gpaBoxY + 8, { align: "center" });

  // ========== GRADUATION DATE ==========
  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(80, 80, 80);
  doc.text(`Lulus pada: ${formatDate(data.graduationDate)}`, pageWidth / 2, 164, { align: "center" });

  // ========== SIGNATURES ==========
  const sigY = pageHeight - 55;
  const leftSigX = 50;
  const rightSigX = pageWidth - 70;

  // Rector signature
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(40, 40, 40);
  doc.text("Rektor,", leftSigX, sigY, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(100, 100, 100);
  doc.text("_________________", leftSigX, sigY + 15, { align: "center" });
  
  doc.setFont("helvetica", "bold");
  doc.text(rectorName, leftSigX, sigY + 21, { align: "center" });

  // Dean signature
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(40, 40, 40);
  doc.text("Dekan,", rightSigX, sigY, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(100, 100, 100);
  doc.text("_________________", rightSigX, sigY + 15, { align: "center" });
  
  doc.setFont("helvetica", "bold");
  doc.text(deanName, rightSigX, sigY + 21, { align: "center" });

  // ========== FOOTER ==========
  doc.setFontSize(8);
  doc.setFont("helvetica", "italic");
  doc.setTextColor(120, 120, 120);
  const footerText = "Dokumen ini diterbitkan secara digital dan tersimpan di blockchain";
  doc.text(footerText, pageWidth / 2, pageHeight - 15, { align: "center" });

  // Add certificate ID/hash placeholder
  doc.setFontSize(7);
  const timestamp = new Date().toISOString();
  doc.text(`Diterbitkan: ${timestamp}`, pageWidth / 2, pageHeight - 10, { align: "center" });

  return doc.output("arraybuffer");
}

/**
 * Add decorative corners to the certificate
 */
function addCornerDecorations(doc: jsPDF, pageWidth: number, pageHeight: number) {
  doc.setDrawColor(218, 165, 32);
  doc.setLineWidth(0.8);

  const cornerSize = 15;
  const margin = 15;

  // Top-left corner
  doc.line(margin, margin + cornerSize, margin, margin);
  doc.line(margin, margin, margin + cornerSize, margin);

  // Top-right corner
  doc.line(pageWidth - margin - cornerSize, margin, pageWidth - margin, margin);
  doc.line(pageWidth - margin, margin, pageWidth - margin, margin + cornerSize);

  // Bottom-left corner
  doc.line(margin, pageHeight - margin - cornerSize, margin, pageHeight - margin);
  doc.line(margin, pageHeight - margin, margin + cornerSize, pageHeight - margin);

  // Bottom-right corner
  doc.line(pageWidth - margin - cornerSize, pageHeight - margin, pageWidth - margin, pageHeight - margin);
  doc.line(pageWidth - margin, pageHeight - margin, pageWidth - margin, pageHeight - margin - cornerSize);
}

/**
 * Format date to Indonesian format
 */
function formatDate(dateString: string): string {
  const months = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember"
  ];

  const date = new Date(dateString);
  const day = date.getDate();
  const month = months[date.getMonth()];
  const year = date.getFullYear();

  return `${day} ${month} ${year}`;
}
