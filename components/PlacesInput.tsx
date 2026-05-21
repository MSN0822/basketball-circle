'use client'

import { useEffect, useRef, useState } from 'react'

interface Props {
  value: string
  onChange: (value: string) => void
  onSelect: (name: string, url: string) => void
}

declare global {
  interface Window {
    google: typeof google
    __mapsLoaded?: boolean
  }
}

let mapsLoadPromise: Promise<void> | null = null

function loadGoogleMaps(apiKey: string): Promise<void> {
  if (window.__mapsLoaded) return Promise.resolve()
  if (mapsLoadPromise) return mapsLoadPromise
  const existing = document.querySelector('script[src*="maps.googleapis.com"]')
  if (existing) {
    mapsLoadPromise = new Promise((resolve) => {
      existing.addEventListener('load', () => { window.__mapsLoaded = true; resolve() })
      if (window.google) { window.__mapsLoaded = true; resolve() }
    })
    return mapsLoadPromise
  }
  mapsLoadPromise = new Promise((resolve) => {
    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`
    script.onload = () => { window.__mapsLoaded = true; resolve() }
    document.head.appendChild(script)
  })
  return mapsLoadPromise
}

type Prediction = google.maps.places.AutocompletePrediction

export default function PlacesInput({ value, onChange, onSelect }: Props) {
  const [suggestions, setSuggestions] = useState<Prediction[]>([])
  const [open, setOpen] = useState(false)
  const serviceRef = useRef<google.maps.places.AutocompleteService | null>(null)

  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
    if (!apiKey) return
    loadGoogleMaps(apiKey).then(() => {
      if (!serviceRef.current) {
        serviceRef.current = new google.maps.places.AutocompleteService()
      }
    })
  }, [])

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const text = e.target.value
    onChange(text)
    if (!text || !serviceRef.current) {
      setSuggestions([])
      setOpen(false)
      return
    }
    serviceRef.current.getPlacePredictions({ input: text }, (preds) => {
      setSuggestions(preds ?? [])
      setOpen(true)
    })
  }

  function handleSelect(pred: Prediction) {
    // main_text = 施設名のみ（secondary_text = 住所）
    const name = pred.structured_formatting.main_text
    const url = `https://www.google.com/maps/place/?q=place_id:${pred.place_id}`
    onSelect(name, url)
    setSuggestions([])
    setOpen(false)
  }

  return (
    <div className="relative">
      <input
        value={value}
        onChange={handleChange}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="例: 新宿コズミックスポーツセンター"
        className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus:border-ring"
      />
      {open && suggestions.length > 0 && (
        <ul className="absolute z-50 w-full bg-white border border-input rounded-lg mt-1 shadow-md overflow-auto max-h-52">
          {suggestions.map(pred => (
            <li
              key={pred.place_id}
              onMouseDown={() => handleSelect(pred)}
              className="flex items-baseline gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-accent"
            >
              <span>📍</span>
              <span>
                <span className="font-medium">{pred.structured_formatting.main_text}</span>
                {pred.structured_formatting.secondary_text && (
                  <span className="text-muted-foreground text-xs ml-1.5">
                    {pred.structured_formatting.secondary_text}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
