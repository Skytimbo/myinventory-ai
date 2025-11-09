import { useState, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import Uppy from "@uppy/core";
import { DashboardModal } from "@uppy/react";
import AwsS3 from "@uppy/aws-s3";
import type { UploadResult } from "@uppy/core";
import { Button } from "@/components/ui/button";

interface ObjectUploaderProps {
  maxNumberOfFiles?: number;
  maxFileSize?: number;
  onGetUploadParameters: () => Promise<{
    method: "PUT";
    url: string;
  }>;
  onComplete?: (
    result: UploadResult<Record<string, unknown>, Record<string, unknown>>
  ) => void;
  buttonClassName?: string;
  children: ReactNode;
}

export function ObjectUploader({
  maxNumberOfFiles = 1,
  maxFileSize = 10485760,
  onGetUploadParameters,
  onComplete,
  buttonClassName,
  children,
}: ObjectUploaderProps) {
  const [showModal, setShowModal] = useState(false);
  const uppyRef = useRef<Uppy | null>(null);

  useEffect(() => {
    // Create Uppy instance
    const uppy = new Uppy({
      restrictions: {
        maxNumberOfFiles,
        maxFileSize,
      },
      autoProceed: false,
    });

    // Add plugins and event handlers
    uppy.use(AwsS3, {
      shouldUseMultipart: false,
      getUploadParameters: onGetUploadParameters,
    });

    const handleComplete = (result: UploadResult<Record<string, unknown>, Record<string, unknown>>) => {
      onComplete?.(result);
      setShowModal(false);
    };

    uppy.on("complete", handleComplete);

    uppyRef.current = uppy;

    // Cleanup on unmount
    return () => {
      const u = uppyRef.current;
      if (!u) return; // Guard against double-close

      // Remove event handlers explicitly
      u.off("complete", handleComplete);

      // Remove all plugins
      for (const plugin of u.getPlugins()) {
        u.removePlugin(plugin);
      }

      // Close the instance (unbinds remaining events)
      u.close({ reason: 'unmount' });

      // Null out the ref
      uppyRef.current = null;
    };
  }, []); // Never re-initialize

  // Don't render until Uppy is initialized
  if (!uppyRef.current) {
    return null;
  }

  return (
    <div>
      <Button onClick={() => setShowModal(true)} className={buttonClassName} data-testid="button-upload-image">
        {children}
      </Button>

      <DashboardModal
        uppy={uppyRef.current}
        open={showModal}
        onRequestClose={() => setShowModal(false)}
        proudlyDisplayPoweredByUppy={false}
      />
    </div>
  );
}
