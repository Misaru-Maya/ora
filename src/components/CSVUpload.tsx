import React, { useRef, useState, useCallback, useMemo } from 'react'
import Papa from 'papaparse'
import type { ParseResult } from 'papaparse'
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
    const base = isLanding
      ? 'relative overflow-hidden rounded-[20px] bg-white shadow-[0_12px_60px_-30px_rgba(15,23,42,0.35)]'
      : 'relative overflow-hidden rounded-[10px] bg-white shadow-[0_0_0_1px_rgba(58,133,24,0.3),0_2px_8px_-2px_rgba(58,133,24,0.15)]'

    const hover = isLanding
      ? 'transition-transform duration-200 ease-out hover:shadow-[0_40px_80px_-35px_rgba(15,23,42,0.35)]'
      : 'transition-all duration-150 ease-out hover:bg-[#F0FDF4] hover:shadow-[0_0_0_1px_rgba(58,133,24,0.5),0_4px_12px_-2px_rgba(58,133,24,0.25)]'

    const active = isLanding
      ? isDragOver
        ? 'ring-4 ring-brand-green/30 shadow-[0_45px_90px_-35px_rgba(22,163,74,0.5)] scale-[1.01]'
        : ''
      : isDragOver
        ? 'bg-[#E8F5E9] shadow-[0_0_0_2px_rgba(58,133,24,0.4),0_4px_12px_-2px_rgba(58,133,24,0.3)]'
        : ''

    return [base, hover, active, 'cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-green/30']
      .filter(Boolean)
      .join(' ')
  }, [isDragOver, isLanding])

  const paddingClasses = isLanding ? 'px-32 py-24 text-center' : 'px-8 py-5 text-center'

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
        <div className={isLanding ? paddingClasses : 'text-center'} style={isLanding ? undefined : { padding: '12px 24px' }}>
          {isLanding ? (
            <h2 className="text-xl font-semibold text-brand-gray">Upload your CSV</h2>
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
          {isLanding && (
            <p className="mt-3 text-sm text-brand-gray/70">
              Supports CSV files · Drag & drop or click to browse
            </p>
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
}
