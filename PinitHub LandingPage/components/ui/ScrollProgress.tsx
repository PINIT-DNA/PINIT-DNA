'use client';

import { motion, useScroll, useSpring } from 'framer-motion';

/** Hairline reading-progress bar pinned above the navbar. */
export function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 120, damping: 28, restDelta: 0.001 });

  return (
    <motion.div
      aria-hidden
      style={{ scaleX }}
      className="fixed inset-x-0 top-0 z-[60] h-[2px] origin-left bg-[linear-gradient(90deg,#55E6FF,#2D7BFF_55%,#6F5CFF)] shadow-[0_0_12px_rgba(45,123,255,0.6)]"
    />
  );
}
