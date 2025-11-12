import React, { useState, useEffect, useRef, useCallback } from 'react';
import io from 'socket.io-client';

interface Color {
  hex: string;
  name: string;
}

interface LeaderboardEntry {
  displayName: string;
  highScore: number;
  highScoreTime?: string;
}

const ColorGuessingGame: React.FC = () => {
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [targetColor, setTargetColor] = useState<Color | null>(null);
  const [feedback, setFeedback] = useState('');
  const [gameOver, setGameOver] = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [playerId, setPlayerId] = useState<string>('');
  const [displayName, setDisplayName] = useState<string>('');
  const [targetRGB, setTargetRGB] = useState<[number, number, number] | null>(null);
  const [showNextButton, setShowNextButton] = useState(false);
  const [hintsOpen, setHintsOpen] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const clickPointRef = useRef<{ x: number, y: number } | null>(null);

  const rgbToHex = (r: number, g: number, b: number) =>
    '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();

  const hslToRgb = useCallback((h: number, s: number, l: number): [number, number, number] => {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (0 <= h && h < 60) [r, g, b] = [c, x, 0];
    else if (h < 120) [r, g, b] = [x, c, 0];
    else if (h < 180) [r, g, b] = [0, c, x];
    else if (h < 240) [r, g, b] = [0, x, c];
    else if (h < 300) [r, g, b] = [x, 0, c];
    else[r, g, b] = [c, 0, x];
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
  }, []);

  const generateTargetColor = useCallback((): Color => {
    // Generate random position within the circle
    const angle = Math.random() * 2 * Math.PI; // Random angle
    const distance = Math.sqrt(Math.random()); // Square root for uniform distribution
    const saturation = distance; // Use distance as saturation (0 to 1)
    const hue = (angle * 180) / Math.PI; // Convert to degrees

    const [r, g, b] = hslToRgb(hue, saturation, 0.5);
    return {
      hex: rgbToHex(r, g, b),
      name: `طیف ${hue.toFixed(0)}°`
    };
  }, [hslToRgb]);

  const drawColorWheel = useCallback((canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    const size = canvas.width;
    const radius = size / 2;
    const imageData = ctx.createImageData(size, size);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - radius;
        const dy = y - radius;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance > radius) continue;

        const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
        const hue = (angle + 360) % 360;
        const sat = distance / radius;
        const [r, g, b] = hslToRgb(hue, sat, 0.5);

        const idx = (y * size + x) * 4;
        imageData.data[idx] = r;
        imageData.data[idx + 1] = g;
        imageData.data[idx + 2] = b;
        imageData.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(imageData, 0, 0);
  }, [hslToRgb]);

  const calculateSimilarity = (hex1: string, hex2: string): number => {
    const r1 = parseInt(hex1.slice(1, 3), 16);
    const g1 = parseInt(hex1.slice(3, 5), 16);
    const b1 = parseInt(hex1.slice(5, 7), 16);
    const r2 = parseInt(hex2.slice(1, 3), 16);
    const g2 = parseInt(hex2.slice(3, 5), 16);
    const b2 = parseInt(hex2.slice(5, 7), 16);
    const distance = Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
    return (1 - distance / Math.sqrt(3 * 255 ** 2)) * 100;
  };

  const getHighSimilarityPixels = (canvas: HTMLCanvasElement, targetHex: string, threshold = 90) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return [];
    const { width, height } = canvas;
    const pixels: { x: number, y: number }[] = [];
    const data = ctx.getImageData(0, 0, width, height).data;
    const tr = parseInt(targetHex.slice(1, 3), 16);
    const tg = parseInt(targetHex.slice(3, 5), 16);
    const tb = parseInt(targetHex.slice(5, 7), 16);

    for (let y = 0; y < height; y += 2) {
      for (let x = 0; x < width; x += 2) {
        const idx = (y * width + x) * 4;
        const r = data[idx], g = data[idx + 1], b = data[idx + 2];
        const sim = (1 - Math.sqrt((r - tr) ** 2 + (g - tg) ** 2 + (b - tb) ** 2) / Math.sqrt(3 * 255 ** 2)) * 100;
        if (sim >= threshold) pixels.push({ x, y });
      }
    }
    return pixels;
  };

  const drawOverlay = (canvas: HTMLCanvasElement) => {
    if (!canvas || !targetColor) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const size = canvas.width;
    const radius = size / 2;

    // redraw color wheel
    drawColorWheel(canvas);

    // Draw high similarity pixels
    const highSimPixels = getHighSimilarityPixels(canvas, targetColor.hex, 90);
    ctx.fillStyle = 'rgba(0,255,0,0.4)';
    highSimPixels.forEach(p => ctx.fillRect(p.x, p.y, 3, 3));

    // Draw target point
    if (targetRGB) {
      const [r, g, b] = targetRGB;
      const hsl = rgbToHsl(r, g, b);
      // Convert HSL back to coordinates
      const tx = radius + Math.cos(hsl.h * Math.PI / 180) * hsl.s * radius;
      const ty = radius + Math.sin(hsl.h * Math.PI / 180) * hsl.s * radius;
      ctx.beginPath();
      ctx.arc(tx, ty, 6, 0, 2 * Math.PI);
      ctx.strokeStyle = 'gold';
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    // Draw click point
    if (clickPointRef.current) {
      const { x, y } = clickPointRef.current;
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, 2 * Math.PI);
      ctx.strokeStyle = 'red';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  };

  const rgbToHsl = (r: number, g: number, b: number) => {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    const d = max - min;
    if (d !== 0) {
      s = d / (1 - Math.abs(2 * l - 1));
      switch (max) {
        case r: h = ((g - b) / d) % 6; break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h *= 60;
      if (h < 0) h += 360;
    }
    return { h, s, l };
  };

  const initializeGame = useCallback(() => {
    const target = generateTargetColor();
    setTargetColor(target);
    setFeedback('');
    setScore(0);
    setGameOver(false);
    setShowNextButton(false);
    clickPointRef.current = null;

    const r = parseInt(target.hex.slice(1, 3), 16);
    const g = parseInt(target.hex.slice(3, 5), 16);
    const b = parseInt(target.hex.slice(5, 7), 16);
    setTargetRGB([r, g, b]);
  }, [generateTargetColor]);

  const nextColor = useCallback(() => {
    const target = generateTargetColor();
    setTargetColor(target);
    setFeedback('');
    setShowNextButton(false);
    clickPointRef.current = null;

    const r = parseInt(target.hex.slice(1, 3), 16);
    const g = parseInt(target.hex.slice(3, 5), 16);
    const b = parseInt(target.hex.slice(5, 7), 16);
    setTargetRGB([r, g, b]);
  }, [generateTargetColor]);

  const API_URL = import.meta.env.VITE_API_URL || 'https://colors.liara.run';

  const fetchLeaderboard = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/leaderboard`);
      const data = await res.json();
      setLeaderboard(data);
    } catch (err) { console.error(err); }
  }, [API_URL]);

  const submitScore = async (name: string, score: number) => {
    try {
      await fetch(`${API_URL}/api/players/submit-score`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId, displayName: name, score })
      });
      fetchLeaderboard();
    } catch (e) { console.error(e); }
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (gameOver || !canvasRef.current || !targetColor || showNextButton) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = Math.floor(e.clientX - rect.left);
    const y = Math.floor(e.clientY - rect.top);
    clickPointRef.current = { x, y };

    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;
    const pixel = ctx.getImageData(x, y, 1, 1).data;
    const clickedHex = rgbToHex(pixel[0], pixel[1], pixel[2]);
    const similarity = calculateSimilarity(clickedHex, targetColor.hex);

    drawOverlay(canvasRef.current);

    if (similarity >= 90) {
      setFeedback(`🎉 درست! ${similarity.toFixed(1)}% تطابق`);
      setScore(prev => prev + 1);
      setShowNextButton(true);
    } else {
      setFeedback(`❌ ${similarity.toFixed(1)}% تطابق`);
      setGameOver(true);
      let name = displayName;
      if (!name) {
        const prompted = prompt('نام نمایشی خود را وارد کنید:');
        if (prompted && prompted.trim()) { name = prompted.trim(); setDisplayName(name); localStorage.setItem('colorGameDisplayName', name); }
      }
      if (name) submitScore(name, score);
      const newHigh = Math.max(score, highScore);
      setHighScore(newHigh);
      localStorage.setItem('colorGameHighScore', newHigh.toString());
    }
  };

  useEffect(() => {
    let id = localStorage.getItem('colorGamePlayerId');
    if (!id) { id = crypto.randomUUID(); localStorage.setItem('colorGamePlayerId', id); }
    setPlayerId(id);
    const savedName = localStorage.getItem('colorGameDisplayName'); if (savedName) setDisplayName(savedName);
    const saved = localStorage.getItem('colorGameHighScore'); if (saved) setHighScore(parseInt(saved));

    fetchLeaderboard();
    initializeGame();

    const socket = io(API_URL);
    socket.on('highScoreUpdated', fetchLeaderboard);
    socket.on('newPlayer', fetchLeaderboard);
    return () => { socket.disconnect(); };
  }, [API_URL, fetchLeaderboard, initializeGame]);

  useEffect(() => {
    if (canvasRef.current) drawColorWheel(canvasRef.current);
  }, [targetColor, drawColorWheel]);

  if (!targetColor) return <div>Loading...</div>;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4">
      <div className="md:hidden absolute top-4 left-4 z-10">
        <span className="text-lg font-semibold text-gray-700 font-estedad">امتیاز: {score}</span>
      </div>
      <div className="md:hidden absolute top-4 right-4 z-10">
        <button onClick={() => setShowLeaderboard(true)} className="bg-blue-500 text-white px-3 py-1 rounded font-estedad text-sm">جدول امتیازات</button>
      </div>
      <div className="hidden md:flex gap-10 justify-between items-center text-lg font-semibold text-gray-700 mb-4">
        <span className="font-estedad">امتیاز: {score}</span>
        <button onClick={() => setShowLeaderboard(true)} className="bg-blue-500 text-white px-4 py-2 rounded font-estedad hover:bg-blue-600 transition">جدول امتیازات</button>
      </div>
      <div className="mb-6">
        <div className="w-32 h-32 mx-auto rounded-full shadow-lg border-4 border-gray-300" style={{ backgroundColor: targetColor.hex }}></div>
      </div>
      <canvas
        ref={canvasRef}
        width={300}
        height={300}
        onClick={handleCanvasClick}
        className={`mx-auto rounded-full cursor-crosshair border-4 border-gray-200 shadow-inner transition-all duration-300 ${gameOver || showNextButton ? 'opacity-75 cursor-not-allowed' : ''}`}
      />

      <div className="mt-4">
        <button
          onClick={() => setHintsOpen(!hintsOpen)}
          className="bg-gray-200 hover:bg-gray-300 text-gray-700 px-4 py-2 rounded-lg transition font-estedad"
        >
          راهنمایی {hintsOpen ? '▲' : '▼'}
        </button>
        {hintsOpen && (
          <div className="mt-2 p-4 bg-blue-50 border border-blue-200 rounded-lg text-center text-gray-700 font-estedad">
            <p>رنگ مشخص شده رو داخل دایره پیدا کن</p>
            <p>تطابق بالای ۹۰ درصد</p>
            <br/>
            <p>🔴 حدس شما</p>
            <p>🟡 جواب دقیق</p>
            <p>محدوده مشخص شده : محدوده رنگ های بالای ۹۰ درصد تطابق</p>
          </div>
        )}
      </div>

      {feedback && (
        <p className="mt-4 text-lg font-semibold text-gray-800 bg-gray-100 rounded-lg p-3 font-estedad">
          {feedback}
        </p>
      )}

      {showNextButton && (
        <div className="mt-4">
          <button
            onClick={nextColor}
            className="bg-green-500 hover:bg-green-600 text-white font-bold py-3 px-8 rounded-full transition-all duration-300 transform hover:scale-105 shadow-lg font-estedad"
          >
            رنگ بعدی →
          </button>
        </div>
      )}

      {gameOver && (
        <div className="mt-6">
          <h3 className="text-2xl font-bold text-gray-800 mb-2 font-estedad">بازی تمام شد!</h3>
          <button
            onClick={initializeGame}
            className="font-bold py-3 px-8 rounded-lg font-estedad border cursor-pointer"
          >
            بازی دوباره
          </button>
        </div>
      )}

      {showLeaderboard && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-4 rounded-lg max-w-sm w-full mx-4" dir="rtl">
            <h3 className="text-xl font-bold mb-4 font-estedad">جدول امتیازات</h3>
            <table className="w-full text-base" dir="rtl">
              <thead>
                <tr className="border-b">
                  <th className="text-right font-estedad">رتبه</th>
                  <th className="text-right font-estedad">نام</th>
                  <th className="text-right font-estedad">امتیاز</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.slice(0, 10).map((entry, index) => (
                  <tr key={index} className="border-b">
                    <td className="py-1 font-inter font-semibold">{index + 1}</td>
                    <td className="py-1 font-inter text-xl">
                      {index === 0 && '🥇 '}
                      {index === 1 && '🥈 '}
                      {index === 2 && '🥉 '}
                      {entry.displayName}
                    </td>
                    <td className="py-1 font-inter font-bold">{entry.highScore}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button
              onClick={() => setShowLeaderboard(false)}
              className="mt-4 bg-red-500 text-white px-4 py-2 rounded font-estedad"
            >
              بستن
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

const App = () => <ColorGuessingGame />;
export default App;