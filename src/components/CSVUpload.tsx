import React, { useRef, useState, useCallback, useMemo } from 'react'
import Papa, { ParseResult } from 'papaparse'
import { parseCSVToDataset } from '../csvParser'
import { useORAStore } from '../store'

interface CSVUploadProps {
  variant?: 'compact' | 'landing'
}

export const CSVUpload: React.FC<CSVUploadProps> = ({ variant = 'compact' }) => {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const { setDataset } = useORAStore()
  const [isDragOver, setIsDragOver] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onFile = useCallback((file: File) => {
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setError('Please select a CSV file.')
      return
    }

    setIsLoading(true)
    setError(null)

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: true,
      complete: (res: ParseResult<any>) => {
        const rows = res.data as any[]
        try {
          const dataset = parseCSVToDataset(rows, file.name)
          setDataset(dataset)
          setError(null)
        } catch (e: any) {
          setError('Failed to parse CSV: ' + e?.message)
          console.error('Failed to parse CSV', e)
        } finally {
          setIsLoading(false)
        }
      },
      error: (err: Error) => {
        setError('CSV parse error: ' + err.message)
        console.error('CSV parse error', err)
        setIsLoading(false)
      }
    })
  }, [setDataset])

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
    const file = e.dataTransfer.files[0]
    if (file) onFile(file)
  }, [onFile])

  const isLanding = variant === 'landing'

  const containerClasses = useMemo(() => {
    const base = isLanding
      ? 'relative overflow-hidden rounded-[20px] bg-white shadow-[0_12px_60px_-30px_rgba(15,23,42,0.35)]'
      : 'relative overflow-hidden rounded-[16px] bg-white border-2 border-dashed border-[#82BC62]'

    const hover = isLanding
      ? 'transition-transform duration-200 ease-out hover:shadow-[0_40px_80px_-35px_rgba(15,23,42,0.35)]'
      : 'transition-colors duration-150 ease-out hover:bg-[#FAFCFE]'

    const active = isLanding
      ? isDragOver
        ? 'ring-4 ring-brand-green/30 shadow-[0_45px_90px_-35px_rgba(22,163,74,0.5)] scale-[1.01]'
        : ''
      : isDragOver
        ? 'bg-brand-pale-green/40 ring-2 ring-brand-green/20'
        : ''

    return [base, hover, active, 'cursor-pointer focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-green/30']
      .filter(Boolean)
      .join(' ')
  }, [isDragOver, isLanding])

  const paddingClasses = isLanding ? 'px-32 py-24 text-center' : 'px-6 py-5 text-center'

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

  return (
    <div className="space-y-3">
      <div
        className={containerClasses}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleBrowse}
        onKeyDown={handleKeyDown}
        role="button"
        tabIndex={0}
        aria-label={isLoading ? 'Processing CSV' : 'Click or drop a CSV to upload'}
      >
        <div className={paddingClasses}>
          <h2 className="text-xl font-semibold text-brand-gray">Upload your CSV</h2>
          {isLanding && (
            <p className="mt-3 text-sm text-brand-gray/70">
              Supports CSV files · Drag & drop or click to browse
            </p>
          )}
          <input
            ref={inputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) onFile(file)
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
}
