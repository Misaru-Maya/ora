import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react'

// Stop words list (common English words to filter out)
const STOP_WORDS = new Set([
  'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves', 'you', 'your', 'yours',
  'yourself', 'yourselves', 'he', 'him', 'his', 'himself', 'she', 'her', 'hers',
  'herself', 'it', 'its', 'itself', 'they', 'them', 'their', 'theirs', 'themselves',
  'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those', 'am', 'is', 'are',
  'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'having', 'do', 'does',
  'did', 'doing', 'a', 'an', 'the', 'and', 'but', 'if', 'or', 'because', 'as', 'until',
  'while', 'of', 'at', 'by', 'for', 'with', 'through', 'during', 'before', 'after',
  'above', 'below', 'up', 'down', 'in', 'out', 'on', 'off', 'over', 'under', 'again',
  'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all',
  'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor',
  'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 's', 't', 'can', 'will',
  'just', 'don', 'should', 'now', 've', 'll', 're',
  'seem', 'think', 'sho', 'shoe', 'shoes', 'really', 'much', "don't", 'would', "won't", "can't", 'could',
  'know', 'like', 'make', 'made', "isn't", 'isn', 'about', 'around', 'way', 'doesn', 'overall', 'wouldn', 'couldn',
  'dont', 'little', 'less', 'skip', 'nothing', 'none', 'meant',
  // Meaningless adjectives
  'good', 'bad', 'nice', 'great', 'stuff', 'okay', 'ok', 'fine',
  'cool', 'awesome', 'amazing', 'horrible', 'terrible', 'awful',
  'decent', 'solid', 'pretty', 'many',
  'thing', 'things', 'something', 'everything', 'anything',
  'lot', 'lots', 'kind', 'kinda', 'sorta', 'bit',
  'definitely', 'absolutely', 'totally', 'basically', 'honestly',
  'perfect', 'excellent', 'wonderful', 'fantastic', 'best', 'worst',
])

// Color palettes matched to ORA brand
const COLOR_PALETTES = {
  positive: [
    '#3A8518',  // brand-green (darkest)
    '#6DAE5B',  // medium green
    '#A5CF8E',  // brand-light-green
    '#B2BBC5',  // silver fog
  ],
  negative: [
    '#E7CB38',  // brand-yellow
    '#ECD560',  // arylide yellow
    '#F1E088',  // wild rice
    '#393C2C',  // dune
  ],
}

interface WordFrequency {
  word: string
  frequency: number
}

interface WordCloudCanvasProps {
  textData: string[]
  questionLabel: string
  containerWidth: number
  containerHeight: number
  wordListWidth?: number
  onWordClick?: (word: string) => void
}

// Check if question is negative based on label
function isNegativeQuestion(label: string): boolean {
  const lower = label.toLowerCase()
  return lower.includes('negative') ||
         lower.includes('dislike') ||
         lower.includes('worst') ||
         lower.includes('least') ||
         lower.includes("don't like") ||
         lower.includes('hate')
}

// Normalize plural to singular
function normalizeToSingular(word: string): string {
  if (word.endsWith('ies') && word.length > 4) {
    return word.slice(0, -3) + 'y'
  } else if (word.endsWith('es') && word.length > 3 && !word.endsWith('ses') && !word.endsWith('xes') && !word.endsWith('zes')) {
    return word.slice(0, -2)
  } else if (word.endsWith('s') && word.length > 3 && !word.endsWith('ss')) {
    return word.slice(0, -1)
  }
  return word
}

// Shuffle array for color assignment
function shuffleArray<T>(array: T[]): T[] {
  const arr = array.slice()
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

// Assign colors with no more than 2 consecutive of same color
function assignColorsNoCluster(baseColors: string[], count: number): string[] {
  const result: string[] = []
  let colorPool = shuffleArray(baseColors)
  let lastColor: string | null = null
  let streak = 0
  let colorIdx = 0

  for (let i = 0; i < count; i++) {
    if (colorIdx >= colorPool.length) {
      colorPool = shuffleArray(baseColors)
      colorIdx = 0
    }
    let color = colorPool[colorIdx]
    if (color === lastColor && streak >= 1) {
      const altIdx = colorPool.findIndex(c => c !== lastColor)
      if (altIdx !== -1) {
        color = colorPool[altIdx]
        colorIdx = altIdx
      }
      streak = 0
    }
    result.push(color)
    if (color === lastColor) streak++
    else streak = 0
    lastColor = color
    colorIdx++
  }
  return result
}

export const WordCloudCanvas: React.FC<WordCloudCanvasProps> = ({
  textData,
  questionLabel,
  containerWidth,
  containerHeight,
  wordListWidth,
  onWordClick,
}) => {
  // Use wordListWidth if provided, otherwise use containerWidth
  const effectiveWordListWidth = wordListWidth || containerWidth
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [wordFrequencies, setWordFrequencies] = useState<WordFrequency[]>([])
  const [removedWords, setRemovedWords] = useState<Set<string>>(new Set())
  const [nlpLoaded, setNlpLoaded] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  // Determine color palette based on question label
  const colorPalette = useMemo(() => {
    return isNegativeQuestion(questionLabel) ? COLOR_PALETTES.negative : COLOR_PALETTES.positive
  }, [questionLabel])

  // Load Compromise.js dynamically
  useEffect(() => {
    const win = window as any
    if (win.nlp) {
      setNlpLoaded(true)
      return
    }

    const script = document.createElement('script')
    script.src = 'https://unpkg.com/compromise@13.11.3/builds/compromise.min.js'
    script.onload = () => setNlpLoaded(true)
    script.onerror = () => console.error('Failed to load Compromise.js')
    document.head.appendChild(script)

    return () => {
      // Don't remove script as other components might need it
    }
  }, [])

  // Process text to extract word frequencies with smart deduplication
  const processText = useCallback((texts: string[]): WordFrequency[] => {
    const nlp = (window as any).nlp
    if (!nlp) return []

    // Step 1: Deduplicate and count occurrences (weighted deduplication)
    // This is much faster than processing duplicates AND more accurate
    const SKIP_RESPONSES = new Set([
      'not specified', 'n/a', 'na', 'none', 'no', 'yes', '-', '--', '---',
      'nothing', 'idk', "i don't know", 'dont know', "don't know", 'no comment',
      'no comments', 'same', 'all good', 'all', 'everything', 'anything',
    ])

    const responseCount = new Map<string, number>()
    texts.forEach(text => {
      const normalized = text.trim().toLowerCase()
      if (normalized && normalized.length > 2 && !SKIP_RESPONSES.has(normalized)) {
        responseCount.set(normalized, (responseCount.get(normalized) || 0) + 1)
      }
    })

    const uniqueResponses = Array.from(responseCount.keys())
    const totalResponses = texts.length
    const uniqueCount = uniqueResponses.length

    console.log(`[WordCloud] Deduplicated: ${totalResponses} total → ${uniqueCount} unique responses (${Math.round((1 - uniqueCount/totalResponses) * 100)}% reduction)`)

    // Step 2: Sample unique responses if still too many
    const MAX_UNIQUE = 2000
    let sampled = uniqueResponses
    let sampleRatio = 1
    if (uniqueCount > MAX_UNIQUE) {
      const shuffled = [...uniqueResponses].sort(() => Math.random() - 0.5)
      sampled = shuffled.slice(0, MAX_UNIQUE)
      sampleRatio = uniqueCount / MAX_UNIQUE
      console.log(`[WordCloud] Sampled ${MAX_UNIQUE} of ${uniqueCount} unique responses`)
    }

    // Step 3: Process each unique response and weight words by occurrence count
    const frequency: Record<string, number> = {}

    sampled.forEach(response => {
      const weight = (responseCount.get(response) || 1) * sampleRatio

      const cleanText = response
        .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim()

      if (!cleanText) return

      const doc = nlp(cleanText)
      const adjectives: string[] = doc.adjectives().terms().out('array')
      const nouns: string[] = doc.nouns().terms().out('array')
      const normalizedNouns = nouns.map(normalizeToSingular)

      const words = [...adjectives, ...normalizedNouns].filter(word =>
        word.length > 2 &&
        !STOP_WORDS.has(word) &&
        !/^\d+$/.test(word) &&
        word !== 'not' &&
        word !== 'specified'
      )

      // Count with weight (how many people gave this response)
      words.forEach(word => {
        frequency[word] = (frequency[word] || 0) + weight
      })
    })

    // Convert to array and sort by frequency
    return Object.entries(frequency)
      .map(([word, freq]) => ({ word, frequency: Math.round(freq) }))
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 30) // Top 30 words
  }, [])

  // Process text data when NLP is loaded
  useEffect(() => {
    if (nlpLoaded && textData.length > 0) {
      setIsLoading(true)
      // Use setTimeout to not block UI
      setTimeout(() => {
        const processed = processText(textData)
        setWordFrequencies(processed)
        setIsLoading(false)
      }, 100)
    }
  }, [nlpLoaded, textData, processText])

  // Render word cloud on canvas
  useEffect(() => {
    if (!canvasRef.current || wordFrequencies.length === 0 || isLoading) return
    if (containerWidth <= 0 || containerHeight <= 0) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Set canvas size
    canvas.width = containerWidth
    canvas.height = containerHeight

    // Clear canvas to transparent
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    const availableWords = wordFrequencies.filter(w => !removedWords.has(w.word))
    if (availableWords.length === 0) {
      ctx.fillStyle = '#7E8BA0'
      ctx.font = '20px "Space Grotesk"'
      ctx.textAlign = 'center'
      ctx.fillText('No words to display', canvas.width / 2, canvas.height / 2)
      return
    }

    // Assign colors
    const colorList = assignColorsNoCluster(colorPalette, availableWords.length)
    const wordColors: Record<string, string> = {}
    availableWords.forEach((w, i) => {
      wordColors[w.word] = colorList[i]
    })

    // Calculate font sizes based on frequency using logarithmic scaling
    // Log scaling prevents one dominant word from making all others tiny
    const maxFont = Math.round(canvas.height / 5)
    const minFont = Math.round(canvas.height / 25)
    const frequencies = availableWords.map(w => w.frequency)
    const maxFreq = Math.max(...frequencies)
    const minFreq = Math.min(...frequencies)

    // Use log scaling to compress the range when there's a dominant word
    const logMaxFreq = Math.log(maxFreq + 1)
    const logMinFreq = Math.log(minFreq + 1)

    const placedRects: Array<{x: number, y: number, width: number, height: number}> = []
    const padding = 2

    // Dynamic shape ratio - compensate for horizontal text spread
    // Use 0.7 multiplier to make circle more round (text naturally spreads horizontally)
    const baseRatio = canvas.width / canvas.height
    const shapeRatio = baseRatio * 0.7

    availableWords.forEach((wordData, index) => {
      let fontSize: number
      if (logMaxFreq === logMinFreq) {
        fontSize = maxFont
      } else {
        // Logarithmic scaling: compresses range so dominant words don't dwarf others
        const logFreq = Math.log(wordData.frequency + 1)
        fontSize = Math.round(minFont + (logFreq - logMinFreq) / (logMaxFreq - logMinFreq) * (maxFont - minFont))
      }

      const color = wordColors[wordData.word]
      let placed = false
      let angle = 0
      let radius = 0
      let attempts = 0
      const maxAttempts = 2000

      // Rotate some words to fill corners and make more circular
      // First few words horizontal, then alternate with vertical
      const wordRotation = (index === 0 || index < 3) ? 0 : (index % 3 === 0 ? Math.PI / 2 : 0)
      const isVertical = wordRotation !== 0

      // Try to place the word, reducing font size if needed
      while (!placed && fontSize >= 10 && attempts < maxAttempts * 3) {
        ctx.font = `${fontSize}px "Space Grotesk"`
        const textWidth = ctx.measureText(wordData.word).width
        const textHeight = fontSize

        // For vertical words, swap width and height for collision detection
        const effectiveWidth = isVertical ? textHeight : textWidth
        const effectiveHeight = isVertical ? textWidth : textHeight

        let localAttempts = 0
        while (!placed && localAttempts < maxAttempts) {
          let x: number, y: number

          if (index === 0) {
            // First word (highest frequency) in center
            x = canvas.width / 2
            y = canvas.height / 2
          } else {
            // Spiral placement with alternating direction
            const spiralDir = (index % 2 === 0) ? 1 : -1
            const spiralAngle = angle * spiralDir
            // Circular shape
            x = canvas.width / 2 + Math.cos(spiralAngle) * radius * shapeRatio
            y = canvas.height / 2 + Math.sin(spiralAngle) * radius
          }

          // Calculate bounding box for collision detection
          const rectX = x - effectiveWidth / 2
          const rectY = y - effectiveHeight / 2
          const rectW = effectiveWidth
          const rectH = effectiveHeight

          const collision = placedRects.some(rect =>
            rectX < rect.x + rect.width &&
            rectX + rectW > rect.x &&
            rectY < rect.y + rect.height &&
            rectY + rectH > rect.y
          )

          if (!collision &&
              rectX >= padding &&
              rectX + rectW <= canvas.width - padding &&
              rectY >= padding &&
              rectY + rectH <= canvas.height - padding) {
            ctx.save()
            ctx.translate(x, y)
            ctx.rotate(wordRotation)
            ctx.fillStyle = color
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.fillText(wordData.word, 0, 0)
            ctx.restore()
            placedRects.push({x: rectX, y: rectY, width: rectW, height: rectH})
            placed = true
            break
          }

          angle += 0.12
          radius += 0.12
          localAttempts++
        }

        if (!placed) {
          fontSize -= 2
          angle = 0
          radius = 0
        }
        attempts++
      }
    })
  }, [wordFrequencies, removedWords, colorPalette, containerWidth, containerHeight, isLoading])

  // Handle word removal/restoration on click
  const handleWordToggle = useCallback((word: string) => {
    setRemovedWords(prev => {
      const next = new Set(prev)
      if (next.has(word)) {
        next.delete(word)
      } else {
        next.add(word)
      }
      return next
    })
    onWordClick?.(word)
  }, [onWordClick])

  // Get available and removed words for display
  const availableWords = useMemo(() =>
    wordFrequencies.filter(w => !removedWords.has(w.word)),
    [wordFrequencies, removedWords]
  )
  const removedWordsList = useMemo(() =>
    wordFrequencies.filter(w => removedWords.has(w.word)),
    [wordFrequencies, removedWords]
  )

  if (isLoading || !nlpLoaded) {
    return (
      <div
        style={{
          width: containerWidth,
          height: containerHeight,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#F8F9FA',
          borderRadius: '12px',
        }}
      >
        <div style={{ color: '#717F90', fontFamily: 'Space Grotesk', fontSize: '14px' }}>
          Generating word cloud...
        </div>
      </div>
    )
  }

  if (textData.length === 0 || wordFrequencies.length === 0) {
    return (
      <div
        style={{
          width: containerWidth,
          height: containerHeight,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#F8F9FA',
          borderRadius: '12px',
        }}
      >
        <div style={{ color: '#717F90', fontFamily: 'Space Grotesk', fontSize: '14px' }}>
          No text responses available
        </div>
      </div>
    )
  }

  return (
    <div style={{ width: '100%', position: 'relative', minHeight: `${containerHeight}px` }}>
      {/* Canvas - left side */}
      <canvas
        ref={canvasRef}
        style={{
          width: containerWidth,
          height: containerHeight,
          borderRadius: '12px',
          backgroundColor: '#FFFFFF',
        }}
      />

      {/* Word list for removal/restoration - fixed position on right */}
      <div style={{
        position: 'absolute',
        top: 0,
        right: 0,
        display: 'flex',
        flexWrap: 'wrap',
        gap: '8px',
        maxHeight: `${containerHeight}px`,
        overflowY: 'auto',
        padding: '8px',
        backgroundColor: '#F8F9FA',
        borderRadius: '8px',
        width: '280px',
        boxSizing: 'border-box',
        alignContent: 'flex-start',
      }}>
        {availableWords.map(({ word, frequency }) => (
          <button
            key={word}
            onClick={() => handleWordToggle(word)}
            style={{
              padding: '4px 10px',
              borderRadius: '9999px',
              border: '1px solid #E5E8EC',
              backgroundColor: 'white',
              fontFamily: 'Space Grotesk',
              fontSize: '12px',
              color: '#717F90',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = '#3A8518'
              e.currentTarget.style.color = '#3A8518'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = '#E5E8EC'
              e.currentTarget.style.color = '#717F90'
            }}
          >
            {word}
            <span style={{
              backgroundColor: colorPalette[0],
              color: 'white',
              padding: '1px 6px',
              borderRadius: '9999px',
              fontSize: '10px',
              fontWeight: 600,
            }}>
              {frequency}
            </span>
          </button>
        ))}

        {removedWordsList.map(({ word, frequency }) => (
          <button
            key={`removed-${word}`}
            onClick={() => handleWordToggle(word)}
            style={{
              padding: '4px 10px',
              borderRadius: '9999px',
              border: '1px solid #E5E8EC',
              backgroundColor: '#FEE2E2',
              fontFamily: 'Space Grotesk',
              fontSize: '12px',
              color: '#9CA3AF',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              opacity: 0.6,
              textDecoration: 'line-through',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.opacity = '1'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.opacity = '0.6'
            }}
          >
            {word}
            <span style={{
              backgroundColor: '#9CA3AF',
              color: 'white',
              padding: '1px 6px',
              borderRadius: '9999px',
              fontSize: '10px',
              fontWeight: 600,
            }}>
              {frequency}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
