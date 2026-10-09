import { useState, useCallback } from 'react';

export function ColorWheel({ onChange }) {
  const [rotation, setRotation] = useState(0);
  
  // Google Calendar color mapping (HSL approximations)
  const colors = [
    '#166390', '#a4282a', '#9e52d5', '#46bd37', '#8e44ad',
    '#fbbc0b', '#eaac4e', '#94d82f', '#399991', '#222222',
    '#a8abeb', '#6a4c93'
  ];

  const handleWheel = (_e) => {
    setRotation(prev => (prev + 5) % 360);
    // Map rotation to color index approximately
    const index = Math.floor(((rotation + 4) % colors.length));
    const newColor = colors[index];
    if (onChange) onChange(newColor);
  };

  return (
    <div className="color-wheel-container">
      <svg
        viewBox="0 0 200 200"
        width={148}
        height={148}
        onClick={handleWheel}
        style={{ 
          cursor: 'pointer', 
          filter: 'drop-shadow(0px 2px 4px rgba(0,0,0,0.3))'
        }}
      >
        <defs>
          {/* Full color spectrum ring */}
          <radialGradient id="spectrum" cx="50%" cy="50%" r="90%">
            {colors.flatMap((c, i) => [
              ['circle', `${i * 360 / colors.length + 15}deg`, c],
              ['circle', `${i * 360 / colors.length + 185}deg`, 'rgba(255,255,255,0)'],
            ])}
          </radialGradient>
          
          {/* Inner lighter ring */}
          <radialGradient id="inner" cx="50%" cy="50%" r="80%">
            {colors.flatMap((c, i) => [
              ['circle', `${i * 360 / colors.length + 15}deg`, 'color-mix(in srgb, ' + c + ' 50%, transparent)'],
              ['circle', `${i * 360 / colors.length + 185}deg`, `color-mix(in srgb, ${colors[i]} 40%), color-mix(in srgb, white 15%, transparent)`],
            ])}
          </radialGradient>
          
          {/* Selected color indicator */}
          <circle id="wheel-indicator" cx="0" cy="0" r="6" fill="white" stroke="rgba(0,0,0,0.3)" strokeWidth="2" />
        </defs>
        
        {/* Outer spectrum ring */}
        <circle cx="100" cy="100" r="85" fill="url(#spectrum)" />
        
        {/* Inner lighter ring */}
        <circle cx="100" cy="100" r="75" fill="url(#inner)" />
        
        {/* Indicator that rotates with wheel */}
        <g transform={`rotate(${-rotation}, 100, 100)`}>
          <use href="#wheel-indicator" transform="translate(-85 -20)" />
        </g>
      </svg>
      
      {/* Color preview swatch below wheel */}
      {onChange && (
        <div
          className="color-preview"
          style={{ background: `hsl(${rotation > 90 ? rotation - 90 % 360 : 0}, 50%, ${40 + Math.floor((rotation / 360) * 70)}%)` }}
        />
      )}
    </div>
  );
}

export default ColorWheel;
