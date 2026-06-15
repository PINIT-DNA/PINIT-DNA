import { motion } from 'framer-motion';

interface Props {
  dnaRecordId: string;
  filename: string;
  fileSizeBytes: number;
  status: string;
  generatedAt?: string;
  successfulLayers: number;
  fileType?: string;
  engineVersion?: string;
}

export function DnaRecordCard({
  dnaRecordId,
  filename,
  fileSizeBytes,
  status,
  generatedAt,
  successfulLayers,
  fileType,
  engineVersion,
}: Props) {
  const formatBytes = (b: number) =>
    b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(2)} MB` : `${(b / 1024).toFixed(1)} KB`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="card border-dna-500/30 bg-dna-500/5"
    >
      <div className="flex items-center gap-3 mb-4">
        <div className="text-2xl">🧬</div>
        <div>
          <p className="text-dna-400 mono text-xs font-medium">DNA RECORD CREATED</p>
          <p className="text-white font-semibold">Record ID Generated</p>
        </div>
        <div className="ml-auto">
          <span
            className={`
              mono text-xs px-2 py-1 rounded-full font-medium
              ${status === 'COMPLETE'
                ? 'bg-layer-complete/20 text-layer-complete'
                : 'bg-yellow-400/20 text-yellow-400'
              }
            `}
          >
            {status}
          </span>
        </div>
      </div>

      <div className="space-y-2">
        {/* DNA ID */}
        <div className="flex items-start gap-3 bg-bg-base rounded-lg p-3">
          <span className="text-gray-500 text-xs mono shrink-0 mt-0.5">DNA ID</span>
          <span className="mono text-xs text-dna-400 break-all">{dnaRecordId}</span>
        </div>

        {/* File info */}
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-bg-base rounded-lg p-3">
            <p className="text-gray-500 text-xs mono mb-1">FILE</p>
            <p className="text-white text-sm font-medium truncate">{filename}</p>
          </div>
          <div className="bg-bg-base rounded-lg p-3">
            <p className="text-gray-500 text-xs mono mb-1">SIZE</p>
            <p className="text-white text-sm font-medium">{formatBytes(fileSizeBytes)}</p>
          </div>
          <div className="bg-bg-base rounded-lg p-3">
            <p className="text-gray-500 text-xs mono mb-1">LAYERS</p>
            <p className="text-layer-complete text-sm font-semibold mono">
              {successfulLayers}/10 Complete
            </p>
          </div>
          <div className="bg-bg-base rounded-lg p-3">
            <p className="text-gray-500 text-xs mono mb-1">FILE TYPE</p>
            <p className="text-dna-400 text-sm font-semibold mono">
              {fileType ?? 'IMAGE'}
            </p>
          </div>
          {engineVersion && (
            <div className="bg-bg-base rounded-lg p-3 col-span-2">
              <p className="text-gray-500 text-xs mono mb-1">ENGINE</p>
              <p className="text-white text-xs mono">{engineVersion}</p>
            </div>
          )}
        </div>

        {generatedAt && (
          <div className="bg-bg-base rounded-lg p-3">
            <p className="text-gray-500 text-xs mono mb-1">TIMESTAMP</p>
            <p className="text-gray-300 text-xs mono">{new Date(generatedAt).toLocaleString()}</p>
          </div>
        )}
      </div>
    </motion.div>
  );
}
