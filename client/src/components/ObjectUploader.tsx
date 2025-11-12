import { useState, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import Uppy from "@uppy/core";
import DashboardModal from "@uppy/react/dashboard-modal";
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

      // Use defensive cleanup: try official lifecycle methods first
      const anyU = u as any;

      // Prefer close() which properly cleans up plugins and events
      if (typeof anyU.close === 'function') {
        anyU.close({ reason: 'unmount' });
      }
      // Fallback to destroy() if available
      else if (typeof anyU.destroy === 'function') {
        anyU.destroy();
      }
      // Last resort: manually remove plugins if getPlugins is available
      else if (typeof anyU.getPlugins === 'function') {
        try {
          const plugins = anyU.getPlugins();
          if (plugins && typeof plugins[Symbol.iterator] === 'function') {
            for (const plugin of plugins) {
              u.removePlugin(plugin);
            }
          }
        } catch (err) {
          console.warn('Failed to clean up Uppy plugins:', err);
        }
      }

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
