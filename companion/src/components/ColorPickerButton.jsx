function ColorPickerButton({ currentColor = '#58cc02', onSelect, onClick }) {
  const handleChange = (e) => {
    const newColor = e.target.value;
    if (onSelect) {
      onSelect(newColor);
    } else if (onClick) {
      onClick(newColor);
    }
  };

  return (
    <div
      className="color-picker-wrapper"
      style={{ background: currentColor || '#58cc02' }}
      onClick={onSelect ? undefined : onClick}
    >
      <input
        type="color"
        value={currentColor}
        onChange={handleChange}
        disabled={!onClick && !onSelect}
        style={{
          border: 'none',
          width: '28px',
          height: '20px',
          padding: 0,
          margin: 0,
          cursor: onClick ? 'pointer' : 'default',
          filter: onClick ? undefined : 'drop-shadow(0px 1px 2px rgba(0,0,0,0.15))',
        }}
      />
    </div>
  );
}

export default ColorPickerButton;
