/**
 * Receipt PDF made on the device: the receipt HTML is laid out in an off-screen iframe (so app styles
 * never leak in), drawn with html2canvas and placed on A4 pages with jsPDF. Both libraries load lazily.
 */
const A4_WIDTH_PX = 794;
const A4_HEIGHT_PX = 1123;

let libs: Promise<[typeof import('html2canvas'), typeof import('jspdf')]> | null = null;
function loadLibs() {
  libs ??= Promise.all([import('html2canvas'), import('jspdf')]);
  libs.catch(() => { libs = null; });
  return libs;
}

/** Fetches the PDF libraries ahead of the first receipt (call when the app is idle). */
export function preloadReceiptPdf() {
  void loadLibs().catch(() => {});
}

const logos = new Map<string, Promise<string>>();

/** The logo as a data URI so the canvas is not tainted; '' when the host does not allow it. */
export function logoDataUri(url: string): Promise<string> {
  if (!url) return Promise.resolve('');
  let hit = logos.get(url);
  if (!hit) {
    hit = fetch(url, { mode: 'cors' })
      .then((res) => (res.ok ? res.blob() : Promise.reject(new Error(String(res.status)))))
      .then((blob) => new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      }))
      .catch(() => '');
    logos.set(url, hit);
  }
  return hit;
}

function frameFor(html: string): Promise<HTMLIFrameElement> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.style.cssText = `position:fixed;left:-${A4_WIDTH_PX * 2}px;top:0;width:${A4_WIDTH_PX}px;height:${A4_HEIGHT_PX}px;border:0;pointer-events:none`;
    frame.onload = () => resolve(frame);
    frame.onerror = () => { frame.remove(); reject(new Error('Could not lay out the receipt')); };
    frame.srcdoc = html;
    document.body.appendChild(frame);
  });
}

export async function buildReceiptPdf(html: string, fileName: string): Promise<File> {
  const [[{ default: html2canvas }, { jsPDF }], frame] = await Promise.all([loadLibs(), frameFor(html)]);
  try {
    const doc = frame.contentDocument!;
    await Promise.all([...doc.images].map((img) => img.decode().catch(() => img.remove())));
    const root = doc.documentElement;
    const height = Math.max(root.scrollHeight, A4_HEIGHT_PX);
    const canvas = await html2canvas(root, {
      scale: 2,
      backgroundColor: '#ffffff',
      width: A4_WIDTH_PX,
      height,
      windowWidth: A4_WIDTH_PX,
      windowHeight: height,
      logging: false,
    });

    const pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const imgH = (canvas.height * pageW) / canvas.width;
    const image = canvas.toDataURL('image/jpeg', 0.88);
    for (let top = 0, page = 0; top < imgH - 1; top += pageH, page++) {
      if (page) pdf.addPage();
      pdf.addImage(image, 'JPEG', 0, -top, pageW, imgH);
    }
    return new File([pdf.output('blob')], fileName, { type: 'application/pdf' });
  } finally {
    frame.remove();
  }
}

export function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
