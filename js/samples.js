// Built-in example drawings, rendered to a canvas so the app opens with something to show.

function canvas(w = 600, h = 600) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, w, h);
  return [c, g];
}

/** Solid silhouette with light features (eyes, smile, buttons) that become stamp lines. */
function gingerbread() {
  const [c, g] = canvas();
  g.fillStyle = '#111';
  g.strokeStyle = '#111';
  g.lineCap = 'round';
  g.beginPath(); g.arc(300, 140, 88, 0, Math.PI * 2); g.fill();
  g.lineWidth = 92;
  g.beginPath(); g.moveTo(300, 200); g.lineTo(300, 360); g.stroke();
  g.lineWidth = 70;
  g.beginPath(); g.moveTo(130, 250); g.quadraticCurveTo(300, 225, 470, 250); g.stroke();
  g.lineWidth = 78;
  g.beginPath(); g.moveTo(300, 330); g.lineTo(200, 520); g.stroke();
  g.beginPath(); g.moveTo(300, 330); g.lineTo(400, 520); g.stroke();
  g.beginPath(); g.ellipse(300, 330, 105, 95, 0, 0, Math.PI * 2); g.fill();
  // features
  g.fillStyle = '#fff'; g.strokeStyle = '#fff';
  g.beginPath(); g.arc(268, 125, 13, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(332, 125, 13, 0, Math.PI * 2); g.fill();
  g.lineWidth = 11;
  g.beginPath(); g.arc(300, 150, 42, 0.2 * Math.PI, 0.8 * Math.PI); g.stroke();
  for (const y of [285, 330, 375]) { g.beginPath(); g.arc(300, y, 12, 0, Math.PI * 2); g.fill(); }
  g.lineWidth = 9;
  for (const x of [150, 450]) { g.beginPath(); g.moveTo(x - 6, 228); g.lineTo(x + 6, 272); g.stroke(); }
  return c;
}

/** Line art: an outline drawing with inner strokes (veins). */
function leaf() {
  const [c, g] = canvas();
  g.strokeStyle = '#1a1a1a';
  g.lineJoin = 'round'; g.lineCap = 'round';
  g.lineWidth = 12;
  g.beginPath();
  g.moveTo(300, 40);
  g.bezierCurveTo(470, 140, 520, 330, 330, 500);
  g.lineTo(320, 575);
  g.lineTo(280, 575);
  g.lineTo(270, 500);
  g.bezierCurveTo(80, 330, 130, 140, 300, 40);
  g.closePath();
  g.stroke();
  g.lineWidth = 8;
  g.beginPath(); g.moveTo(300, 110); g.lineTo(300, 470); g.stroke();
  for (const [y, s] of [[190, 90], [270, 125], [350, 115], [420, 70]]) {
    g.beginPath(); g.moveTo(300, y + 40); g.quadraticCurveTo(300 + s * 0.4, y + 10, 300 + s, y); g.stroke();
    g.beginPath(); g.moveTo(300, y + 40); g.quadraticCurveTo(300 - s * 0.4, y + 10, 300 - s, y); g.stroke();
  }
  return c;
}

/** Plain rounded star. */
function star() {
  const [c, g] = canvas();
  g.fillStyle = '#111'; g.strokeStyle = '#111';
  g.lineJoin = 'round'; g.lineWidth = 40;
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 105 : 245, a = -Math.PI / 2 + (i * Math.PI) / 5;
    const x = 300 + r * Math.cos(a), y = 320 + r * Math.sin(a);
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  }
  g.closePath(); g.fill(); g.stroke();
  return c;
}

export const SAMPLES = [
  { id: 'gingerbread', name: 'Gingerbread', make: gingerbread },
  { id: 'leaf', name: 'Leaf line art', make: leaf },
  { id: 'star', name: 'Star', make: star },
];
