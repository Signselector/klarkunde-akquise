import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const VIEW = 280; // viewport in px
const OUT = 256; // saved picture in px

/** Circle picker for a profile picture: drag the image, zoom with the slider, the circle is what gets saved. */
export function AvatarCropper({
  file,
  busy,
  onCancel,
  onConfirm,
}: {
  file: File | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (blob: Blob) => void;
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  useEffect(() => {
    if (!file) {
      setImg(null);
      setSrc(null);
      return;
    }
    const url = URL.createObjectURL(file);
    const i = new Image();
    i.onload = () => {
      setImg(i);
      setSrc(url);
      setZoom(1);
      setOff({ x: 0, y: 0 });
    };
    i.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const base = img ? VIEW / Math.min(img.naturalWidth, img.naturalHeight) : 1;
  const s = base * zoom;
  const w = img ? img.naturalWidth * s : VIEW;
  const h = img ? img.naturalHeight * s : VIEW;
  const clamp = (o: { x: number; y: number }) => ({
    x: Math.max(-(w - VIEW) / 2, Math.min((w - VIEW) / 2, o.x)),
    y: Math.max(-(h - VIEW) / 2, Math.min((h - VIEW) / 2, o.y)),
  });
  const pos = clamp(off);

  function confirm() {
    if (!img) return;
    const left = VIEW / 2 - w / 2 + pos.x;
    const top = VIEW / 2 - h / 2 + pos.y;
    const canvas = document.createElement("canvas");
    canvas.width = OUT;
    canvas.height = OUT;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, OUT, OUT);
    ctx.drawImage(img, -left / s, -top / s, VIEW / s, VIEW / s, 0, 0, OUT, OUT);
    canvas.toBlob((b) => b && onConfirm(b), "image/jpeg", 0.9);
  }

  return (
    <Dialog open={!!file} onOpenChange={(o) => !o && !busy && onCancel()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Profilbild zuschneiden</DialogTitle>
          <DialogDescription>
            Verschiebe das Bild und stelle den Zoom ein. Der Kreis zeigt, was gespeichert wird.
          </DialogDescription>
        </DialogHeader>
        <div className="grid justify-items-center gap-4">
          <div
            className="cc-crop-view"
            style={{ width: VIEW, height: VIEW }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              drag.current = { x: e.clientX, y: e.clientY, ox: pos.x, oy: pos.y };
            }}
            onPointerMove={(e) => {
              if (!drag.current) return;
              setOff({
                x: drag.current.ox + e.clientX - drag.current.x,
                y: drag.current.oy + e.clientY - drag.current.y,
              });
            }}
            onPointerUp={() => (drag.current = null)}
            onPointerCancel={() => (drag.current = null)}
          >
            {src && (
              <img
                src={src}
                alt=""
                draggable={false}
                style={{
                  width: w,
                  height: h,
                  left: VIEW / 2 - w / 2 + pos.x,
                  top: VIEW / 2 - h / 2 + pos.y,
                }}
              />
            )}
            <div className="cc-crop-mask" aria-hidden="true" />
          </div>
          <label className="flex w-full items-center gap-3 text-sm">
            Zoom
            <input
              type="range"
              min={1}
              max={3}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="w-full accent-[#2563eb]"
              aria-label="Zoom"
            />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onCancel}>
            Abbrechen
          </Button>
          <Button disabled={busy || !img} onClick={confirm}>
            {busy ? "Wird gespeichert …" : "Übernehmen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
