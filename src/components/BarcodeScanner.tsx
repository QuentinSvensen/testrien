import { useState, useEffect } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { X, Scan, Loader2 } from "lucide-react";
import { Button } from "./ui/button";
import { toast } from "@/hooks/use-toast";

interface BarcodeScannerProps {
  onScanSuccess: (data: {
    name: string;
    grams?: string;
    calories?: string;
    protein?: string;
  }) => void;
  onClose: () => void;
}

export function BarcodeScanner({ onScanSuccess, onClose }: BarcodeScannerProps) {
  const [scanning, setScanning] = useState(false);
  const [loading, setLoading] = useState(false);
  const scannerId = "barcode-scanner-viewport";

  useEffect(() => {
    const html5QrCode = new Html5Qrcode(scannerId);
    
    const startScanner = async () => {
      try {
        setScanning(true);
        await html5QrCode.start(
          { facingMode: "environment" },
          {
            fps: 10,
            qrbox: { width: 250, height: 150 },
          },
          async (decodedText) => {
            await html5QrCode.stop();
            setScanning(false);
            fetchProductData(decodedText);
          },
          () => {}
        );
      } catch (err: any) {
        console.error("Scanner error:", err);
        const errorMsg = err?.message || String(err);
        toast({ 
          title: "Erreur caméra", 
          description: `Impossible d'accéder à la caméra. Détails : ${errorMsg}`, 
          variant: "destructive" 
        });
        onClose();
      }
    };

    startScanner();

    return () => {
      if (html5QrCode.isScanning) {
        html5QrCode.stop().catch(console.error);
      }
    };
  }, []);

  const fetchProductData = async (barcode: string) => {
    setLoading(true);
    try {
      const response = await fetch(`https://world.openfoodfacts.org/api/v0/product/${barcode}.json`);
      const data = await response.json();

      if (data.status === 1) {
        const p = data.product;
        const name = p.product_name_fr || p.product_name || "Produit inconnu";
        const gramsRaw = (p.quantity || "").toLowerCase().replace(',', '.');
        let grams = "";
        
        const unitMatch = gramsRaw.match(/(\d+(?:\.\d+)?)\s*([a-z]+)/);
        if (unitMatch) {
          const value = parseFloat(unitMatch[1]);
          const unit = unitMatch[2];
          
          if (unit === 'l' || unit === 'kg') {
            grams = Math.round(value * 1000).toString();
          } else if (unit === 'cl') {
            grams = Math.round(value * 10).toString();
          } else if (unit === 'ml' || unit === 'g') {
            grams = Math.round(value).toString();
          } else {
            grams = unitMatch[1]; // Garder tel quel si unité inconnue
          }
        } else {
          const simpleMatch = gramsRaw.match(/(\d+(?:\.\d+)?)/);
          grams = simpleMatch ? simpleMatch[1] : "";
        }
        
        const calories = p.nutriments?.['energy-kcal_100g'] ? Math.round(p.nutriments['energy-kcal_100g']).toString() : "";
        const protein = p.nutriments?.proteins_100g ? p.nutriments.proteins_100g.toString().replace('.', ',') : "";

        onScanSuccess({ name, grams, calories, protein });
        toast({ title: "Produit trouvé ! 🎯", description: name });
        onClose();
      } else {
        toast({ title: "Produit non trouvé", description: "Ce code-barres n'est pas dans la base Open Food Facts.", variant: "destructive" });
        onClose();
      }
    } catch (err) {
      toast({ title: "Erreur réseau", description: "Impossible de contacter Open Food Facts.", variant: "destructive" });
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <style>{`
        @keyframes scan-line {
          0% { top: 0%; opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { top: 100%; opacity: 0; }
        }
        .animate-scan-line {
          animation: scan-line 2s linear infinite;
        }
      `}</style>
      <div className="bg-card w-full max-w-md rounded-3xl overflow-hidden shadow-2xl border relative">
        <div className="p-4 border-b flex items-center justify-between bg-muted/30">
          <div className="flex items-center gap-2">
            <Scan className="h-5 w-5 text-primary" />
            <h3 className="font-bold">Scanner un article</h3>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full">
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="aspect-square w-full bg-black relative">
          <div id={scannerId} className="w-full h-full" />
          
          {(loading || !scanning) && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 text-white gap-3">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
              <p className="text-sm font-medium">
                {loading ? "Recherche sur Open Food Facts..." : "Initialisation caméra..."}
              </p>
            </div>
          )}

          {scanning && !loading && (
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute inset-0 border-[40px] border-black/40" />
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[250px] h-[150px] border-2 border-primary rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]">
                <div className="absolute top-0 left-0 w-4 h-4 border-t-4 border-l-4 border-primary -translate-x-1 -translate-y-1" />
                <div className="absolute top-0 right-0 w-4 h-4 border-t-4 border-r-4 border-primary translate-x-1 -translate-y-1" />
                <div className="absolute bottom-0 left-0 w-4 h-4 border-b-4 border-l-4 border-primary -translate-x-1 translate-y-1" />
                <div className="absolute bottom-0 right-0 w-4 h-4 border-b-4 border-r-4 border-primary translate-x-1 translate-y-1" />
              </div>
              <div className="absolute top-[calc(50%-75px)] left-1/2 -translate-x-1/2 w-[250px] h-[2px] bg-primary animate-scan-line shadow-[0_0_8px_rgba(var(--primary),0.8)]" />
            </div>
          )}
        </div>

        <div className="p-6 text-center">
          <p className="text-sm text-muted-foreground">
            Placez le code-barres de l'article dans le cadre pour le scanner automatiquement.
          </p>
        </div>
      </div>
    </div>
  );
}
