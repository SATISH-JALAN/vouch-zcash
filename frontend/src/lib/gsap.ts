'use client'

// Plugin registration, exactly once, client only. Observer is left out until something uses it.
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { SplitText } from 'gsap/SplitText'
import { DrawSVGPlugin } from 'gsap/DrawSVGPlugin'
import { ScrambleTextPlugin } from 'gsap/ScrambleTextPlugin'
import { Flip } from 'gsap/Flip'
import { MorphSVGPlugin } from 'gsap/MorphSVGPlugin'
import { useGSAP } from '@gsap/react'

if (typeof window !== 'undefined') {
  gsap.registerPlugin(ScrollTrigger, SplitText, DrawSVGPlugin, ScrambleTextPlugin, Flip, MorphSVGPlugin, useGSAP)
  gsap.defaults({ ease: 'power3.out' })
}

export { gsap, ScrollTrigger, SplitText, DrawSVGPlugin, Flip, MorphSVGPlugin, useGSAP }
