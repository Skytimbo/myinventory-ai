import { useState, useRef, useCallback } from "react";
import Webcam from "react-webcam";
import { Camera, Upload, RefreshCw, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface CameraCaptureProps {
  onImageCapture: (imageDataUrl: string) => void;
}

export function CameraCapture({ onImageCapture }: CameraCaptureProps) {
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const webcamRef = useRef<Webcam>(null);

  const capture = useCallback(() => {
    const imageSrc = webcamRef.current?.getScreenshot();
    if (imageSrc) {
      setCapturedImage(imageSrc);
    }
  }, [webcamRef]);

  const retake = () => {
    setCapturedImage(null);
  };

  const useImage = () => {
    if (capturedImage) {
      onImageCapture(capturedImage);
      setCapturedImage(null);
      setIsCameraActive(false);
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        onImageCapture(result);
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto px-4 py-8 md:py-12">
      <div className="text-center mb-6">
        <h1 className="text-4xl md:text-5xl font-semibold text-foreground mb-3">MyInventory AI</h1>
        <p className="text-base text-muted-foreground">
          Capture or upload a photo to identify and catalog your items
        </p>
      </div>

      {!isCameraActive && !capturedImage && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <Button
              size="lg"
              onClick={() => setIsCameraActive(true)}
              className="w-full sm:w-auto min-w-48"
              data-testid="button-open-camera"
            >
              <Camera className="w-5 h-5 mr-2" />
              Take Photo
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={() => document.getElementById('file-input')?.click()}
              className="w-full sm:w-auto min-w-48"
              data-testid="button-upload-file"
            >
              <Upload className="w-5 h-5 mr-2" />
              Upload Image
            </Button>
            <input
              id="file-input"
              type="file"
              accept="image/*"
              onChange={handleFileSelect}
              className="hidden"
              data-testid="input-file-upload"
            />
          </div>
        </div>
      )}

      {isCameraActive && (
        <Card className="overflow-hidden">
          <div className="relative">
            {capturedImage ? (
              <img
                src={capturedImage}
                alt="Captured"
                className="w-full aspect-square object-cover"
                data-testid="img-captured-preview"
              />
            ) : (
              <Webcam
                ref={webcamRef}
                audio={false}
                screenshotFormat="image/jpeg"
                videoConstraints={{
                  facingMode: "environment",
                }}
                className="w-full aspect-square object-cover"
                data-testid="video-webcam"
              />
            )}

            <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-black/60 to-transparent">
              <div className="flex gap-3 justify-center">
                {capturedImage ? (
                  <>
                    <Button
                      size="lg"
                      variant="outline"
                      onClick={retake}
                      className="backdrop-blur-md bg-white/90 hover:bg-white"
                      data-testid="button-retake"
                    >
                      <RefreshCw className="w-5 h-5 mr-2" />
                      Retake
                    </Button>
                    <Button
                      size="lg"
                      onClick={useImage}
                      className="backdrop-blur-md"
                      data-testid="button-use-image"
                    >
                      <Check className="w-5 h-5 mr-2" />
                      Use This Photo
                    </Button>
                  </>
                ) : (
                  <Button
                    size="lg"
                    onClick={capture}
                    className="backdrop-blur-md"
                    data-testid="button-capture"
                  >
                    <Camera className="w-5 h-5 mr-2" />
                    Capture
                  </Button>
                )}
              </div>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
