import React from 'react';
import { ShieldCheck, Lock } from 'lucide-react';
import photo from '../assets/hero-photo.png';
import cinematic from '../assets/hero-cinematic.png';
import digitalArt from '../assets/hero-digital-art.png';
import ui from '../assets/hero-ui.png';
import threeD from '../assets/hero-3d.png';
import illustration from '../assets/hero-illustration.png';
import audio from '../assets/hero-audio.png';

/** Decorative editorial collage — original placeholder imagery only. */
export default function DiscoverHeroArt() {
  return (
    <div className="market-hero__art" aria-hidden="true">
      <div className="market-hero__dna" />

      <figure className="market-hero__card market-hero__card--photo">
        <img src={photo} alt="" />
        <span className="market-hero__mark market-hero__mark--ok">Verified</span>
      </figure>

      <figure className="market-hero__card market-hero__card--cine">
        <img src={cinematic} alt="" />
        <i className="market-hero__play" />
      </figure>

      <figure className="market-hero__card market-hero__card--art">
        <img src={digitalArt} alt="" />
      </figure>

      <figure className="market-hero__card market-hero__card--illust">
        <img src={illustration} alt="" />
      </figure>

      <figure className="market-hero__card market-hero__card--obj">
        <img src={threeD} alt="" />
        <span className="market-hero__mark market-hero__mark--dna">Pinit DNA</span>
      </figure>

      <figure className="market-hero__card market-hero__card--ui">
        <img src={ui} alt="" />
      </figure>

      <figure className="market-hero__card market-hero__card--audio">
        <img src={audio} alt="" />
        <span className="market-hero__mark market-hero__mark--lock"><Lock size={9} /> Protected</span>
      </figure>

      <div className="market-hero__seal">
        <ShieldCheck size={16} />
      </div>
    </div>
  );
}
