import type { AvatarSelection } from "./avatar";

const MAX_AVATAR_SIZE = 512;
const AVATAR_IMAGE_QUALITY = 0.82;

type AvatarCrop = {
  sourceX: number;
  sourceY: number;
  sourceSize: number;
  outputSize: number;
};

export function calculateAvatarCrop(width: number, height: number): AvatarCrop {
  if (width <= 0 || height <= 0) {
    throw new Error("The selected image has invalid dimensions.");
  }

  const sourceSize = Math.min(width, height);
  return {
    sourceX: (width - sourceSize) / 2,
    sourceY: (height - sourceSize) / 2,
    sourceSize,
    outputSize: Math.min(sourceSize, MAX_AVATAR_SIZE),
  };
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("The selected image could not be read."));
    });
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(blob);
  });
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.addEventListener("load", () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    });
    image.addEventListener("error", () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("The selected image could not be decoded."));
    });
    image.src = objectUrl;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
          return;
        }
        reject(new Error("The selected image could not be resized."));
      },
      type,
      AVATAR_IMAGE_QUALITY,
    );
  });
}

export async function normalizeAvatarImage(file: File): Promise<AvatarSelection> {
  const image = await loadImage(file);
  const crop = calculateAvatarCrop(image.naturalWidth, image.naturalHeight);
  const canvas = document.createElement("canvas");
  canvas.width = crop.outputSize;
  canvas.height = crop.outputSize;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("Image resizing is not supported by this browser.");

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(
    image,
    crop.sourceX,
    crop.sourceY,
    crop.sourceSize,
    crop.sourceSize,
    0,
    0,
    crop.outputSize,
    crop.outputSize,
  );

  const blob = await canvasToBlob(canvas, file.type);
  return {
    kind: "uploaded",
    dataUrl: await readBlobAsDataUrl(blob),
    fileName: file.name,
  };
}
