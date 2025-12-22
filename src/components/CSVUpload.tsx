import React, { useRef, useState, useCallback, useMemo, forwardRef, useImperativeHandle } from 'react'
import Papa from 'papaparse'
import type { ParseResult } from 'papaparse'
import { parseCSVToDataset } from '../csvParser'
import { useORAStore } from '../store'

interface CSVUploadProps {
  variant?: 'compact' | 'landing'
}

export interface CSVUploadHandle {
  openFileBrowser: () => void
}

export const CSVUpload = forwardRef<CSVUploadHandle, CSVUploadProps>(({ variant = 'compact' }, ref) => {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const { setDataset, setIsLoading: setGlobalLoading } = useORAStore()
  const [isDragOver, setIsDragOver] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onFile = useCallback((file: File) => {
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setError('Please select a CSV file.')
      return
    }

    setIsLoading(true)
    setGlobalLoading(true)  // Show global loading overlay immediately
    setError(null)

    // PERF BASELINE: Start timing total upload
    const uploadStart = performance.now()
    console.log('[PERF] Starting CSV upload:', file.name, 'Size:', (file.size / 1024 / 1024).toFixed(2) + 'MB')

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: true,
      complete: (res: ParseResult<any>) => {
        const papaParseEnd = performance.now()
        console.log('[PERF] Papa.parse complete:', (papaParseEnd - uploadStart).toFixed(0) + 'ms', 'Rows:', res.data.length)

        const rows = res.data as any[]
        try {
          const parseStart = performance.now()
          const dataset = parseCSVToDataset(rows, file.name)
          const parseEnd = performance.now()
          console.log('[PERF] parseCSVToDataset:', (parseEnd - parseStart).toFixed(0) + 'ms')

          const storeStart = performance.now()
          setDataset(dataset)
          const storeEnd = performance.now()
          console.log('[PERF] setDataset (store update):', (storeEnd - storeStart).toFixed(0) + 'ms')

          const totalTime = performance.now() - uploadStart
          console.log('[PERF] ===== TOTAL UPLOAD TIME:', totalTime.toFixed(0) + 'ms =====')

          setError(null)
        } catch (e: any) {
          setError('Failed to parse CSV: ' + e?.message)
          console.error('Failed to parse CSV', e)
          setGlobalLoading(false)  // Clear global loading on error
        } finally {
          setIsLoading(false)
        }
      },
      error: (err: Error) => {
        setError('CSV parse error: ' + err.message)
        console.error('CSV parse error', err)
        setIsLoading(false)
        setGlobalLoading(false)  // Clear global loading on error
      }
    })
  }, [setDataset, setGlobalLoading])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)

    // Block multiple file uploads
    if (e.dataTransfer.files.length > 1) {
      setError('Please upload only one CSV file at a time.')
      return
    }

    const file = e.dataTransfer.files[0]
    if (file) onFile(file)
  }, [onFile])

  const isLanding = variant === 'landing'

  const containerClasses = useMemo(() => {
    if (isLanding) {
      // For landing variant, minimal styling since parent card handles the glassmorphic effect
      const base = 'relative overflow-hidden cursor-pointer'
      const active = isDragOver ? 'scale-[1.02]' : ''
      return [base, active, 'focus:outline-none'].filter(Boolean).join(' ')
    }

    const base = 'relative overflow-hidden rounded-[10px] bg-[#FFFFFF] shadow-[0_0_0_1px_rgba(58,133,24,0.3),0_2px_8px_-2px_rgba(58,133,24,0.15)]'
    const hover = 'transition-all duration-150 ease-out hover:bg-[#F0FDF4] hover:shadow-[0_0_0_1px_rgba(58,133,24,0.5),0_4px_12px_-2px_rgba(58,133,24,0.25)]'
    const active = isDragOver
      ? 'bg-[#E8F5E9] shadow-[0_0_0_2px_rgba(58,133,24,0.4),0_4px_12px_-2px_rgba(58,133,24,0.3)]'
      : ''

    return [base, hover, active, 'cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-green/30']
      .filter(Boolean)
      .join(' ')
  }, [isDragOver, isLanding])

  const paddingClasses = isLanding ? 'text-center' : 'px-8 py-5 text-center'

  const handleBrowse = useCallback(() => {
    if (isLoading) return
    inputRef.current?.click()
  }, [isLoading])

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      handleBrowse()
    }
  }, [handleBrowse])

  // Expose openFileBrowser method to parent components
  useImperativeHandle(ref, () => ({
    openFileBrowser: handleBrowse
  }), [handleBrowse])

  return (
    <div className="space-y-3">
      <div
        className={containerClasses}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={(e) => {
          // Stop propagation to prevent parent's onClick from double-triggering
          e.stopPropagation()
          handleBrowse()
        }}
        onKeyDown={handleKeyDown}
        role="button"
        tabIndex={0}
        aria-label={isLoading ? 'Processing CSV' : 'Click or drop a CSV to upload'}
      >
        <div className={isLanding ? paddingClasses : 'text-center'} style={isLanding ? undefined : { padding: '12px 24px' }}>
          {isLanding ? (
            <>
              {/* Upload icon */}
              <div
                style={{
                  width: '64px',
                  height: '64px',
                  borderRadius: '16px',
                  background: 'linear-gradient(135deg, #3A8518 0%, #22c55e 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 20px',
                  boxShadow: '0 10px 30px -10px rgba(58, 133, 24, 0.4)'
                }}
              >
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              </div>
              <h2 style={{ fontSize: '24px', fontWeight: 600, color: '#1F2937', marginBottom: '8px', fontFamily: 'Space Grotesk, sans-serif' }}>
                Upload your data
              </h2>
              <p style={{ fontSize: '14px', color: '#6B7280', fontFamily: 'Space Grotesk, sans-serif' }}>
                Drop a CSV file or click to browse
              </p>
            </>
          ) : (
            <div className="flex items-center justify-center" style={{ gap: '4px' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3A8518" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <span style={{ fontSize: '12px', fontWeight: 500, color: '#3A8518' }}>Upload CSV</span>
            </div>
          )}
          <input
            ref={inputRef}
            type="file"
            accept=".csv"
            multiple={false}
            className="hidden"
            onChange={(e) => {
              const files = e.target.files
              if (!files || files.length === 0) return

              // Block multiple file uploads
              if (files.length > 1) {
                setError('Please upload only one CSV file at a time.')
                return
              }

              const file = files[0]
              if (file) onFile(file)

              // Reset input value to allow re-uploading the same file
              e.target.value = ''
            }}
          />
          <div className={isLanding ? 'mt-6 text-sm font-semibold text-brand-green' : 'mt-3 text-xs font-semibold text-brand-green'}>
            {isLoading ? 'Processing…' : ''}
          </div>
        </div>
      </div>
      
      {error && (
        <div className="rounded-xl bg-brand-pale-yellow/60 px-3 py-2 text-left text-brand-gray">
          <h3 className="text-sm font-semibold text-brand-gray">Upload error</h3>
          <p className="mt-1 text-xs text-brand-gray/80">{error}</p>
        </div>
      )}
    </div>
  )
})

CSVUpload.displayName = 'CSVUpload'
