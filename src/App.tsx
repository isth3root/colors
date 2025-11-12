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
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const rgbToHex = (r: number, g: number, b: number): string =>
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
    return [
      Math.round((r + m) * 255),
      Math.round((g + m) * 255),
      Math.round((b + m) * 255),
    ];
  }, []);

  const generateTargetColor = useCallback((): Color => {
    const hue = Math.random() * 360;
    const [r, g, b] = hslToRgb(hue, 1, 0.5);
    return {
      hex: rgbToHex(r, g, b),
      name: `طیف ${hue.toFixed(0)}°`,
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
    const maxDistance = Math.sqrt(3 * 255 ** 2);
    return (1 - distance / maxDistance) * 100;
  };

  const initializeGame = useCallback(() => {
    const target = generateTargetColor();
    setTargetColor(target);
    setFeedback('');
    setScore(0);
    setGameOver(false);
  }, [generateTargetColor]);

  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

  const fetchLeaderboard = async () => {
    try {
      const response = await fetch(`${API_URL}/api/leaderboard`);
      const data = await response.json();
      setLeaderboard(data);
    } catch (err) {
      console.error('Failed to fetch leaderboard:', err);
    }
  };

  const submitScore = async (displayName: string, score: number) => {
    try {
      const response = await fetch(`${API_URL}/api/players/submit-score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId, displayName, score })
      });
      if (response.ok) {
        fetchLeaderboard();
      }
    } catch (err) {
      console.error('Failed to submit score:', err);
    }
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (gameOver || !canvasRef.current || !targetColor) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = Math.floor(e.clientX - rect.left);
    const y = Math.floor(e.clientY - rect.top);

    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;
    const pixel = ctx.getImageData(x, y, 1, 1).data;
    const clickedHex = rgbToHex(pixel[0], pixel[1], pixel[2]);

    const similarity = calculateSimilarity(clickedHex, targetColor.hex);

    if (similarity >= 90) {
      setFeedback(`🎉 درست! ${similarity.toFixed(1)}% تطابق`);
      setScore(prev => prev + 1);
      setTimeout(() => {
        setTargetColor(generateTargetColor());
        setFeedback('');
      }, 1500);
    } else {
      setFeedback(`❌ ${similarity.toFixed(1)}% تطابق`);
      setGameOver(true);
      let name = displayName;
      if (!name) {
        const prompted = prompt('نام نمایشی خود را وارد کنید:');
        if (prompted && prompted.trim()) {
          name = prompted.trim();
          setDisplayName(name);
          localStorage.setItem('colorGameDisplayName', name);
        }
      }
      if (name) {
        submitScore(name, score);
      }
      const newHigh = Math.max(score, highScore);
      setHighScore(newHigh);
      localStorage.setItem('colorGameHighScore', newHigh.toString());
    }
  };

  useEffect(() => {
    let id = localStorage.getItem('colorGamePlayerId');
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem('colorGamePlayerId', id);
    }
    setPlayerId(id);

    const savedName = localStorage.getItem('colorGameDisplayName');
    if (savedName) setDisplayName(savedName);

    const saved = localStorage.getItem('colorGameHighScore');
    if (saved) setHighScore(parseInt(saved));

    fetchLeaderboard();
    initializeGame();

    const socket = io(API_URL);
    socket.on('highScoreUpdated', () => {
      fetchLeaderboard();
    });
    socket.on('newPlayer', () => {
      fetchLeaderboard();
    });

    return () => {
      socket.disconnect();
    };
  }, [initializeGame]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) drawColorWheel(canvas);
  }, [targetColor, drawColorWheel]);

  if (!targetColor) return <div>Loading...</div>;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4">
        <div className="md:hidden absolute top-4 left-4 z-10">
          <span className="text-lg font-semibold text-gray-700 font-press-start">امتیاز: {score}</span>
        </div>
        <div className="md:hidden absolute top-4 right-4 z-10">
          <button
            onClick={() => setShowLeaderboard(true)}
            className="bg-blue-500 text-white px-3 py-1 rounded font-press-start text-sm"
          >
            جدول امتیازات
          </button>
        </div>

        <div className="hidden md:flex gap-10 justify-between items-center text-lg font-semibold text-gray-700 mb-4">
          <span className="font-press-start">امتیاز: {score}</span>
          <button
            onClick={() => setShowLeaderboard(true)}
            className="bg-blue-500 text-white px-4 py-2 rounded font-press-start hover:bg-blue-600 transition"
          >
            جدول امتیازات
          </button>
        </div>

        <div className="mb-6">
          <div
            className="w-32 h-32 mx-auto rounded-full shadow-lg border-4 border-gray-300"
            style={{ backgroundColor: targetColor.hex }}
          ></div>
        </div>

        <canvas
          ref={canvasRef}
          width={300}
          height={300}
          onClick={handleCanvasClick}
          className={`mx-auto rounded-full cursor-crosshair border-4 border-gray-200 shadow-inner transition-all duration-300 ${gameOver ? 'opacity-50 cursor-not-allowed' : ''
            }`}
        />

        <p className="mt-4 text-center text-gray-600 ">رنگ مشخص شده رو داخل دایره پیدا کن</p>
        <p className="text-center text-gray-600 ">تطابق بالای ۹۰ درصد</p>

        {feedback && (
          <p className="mt-4 text-lg font-semibold text-gray-800 bg-gray-100 rounded-lg p-3 font-press-start">{feedback}</p>
        )}

        {gameOver && (
          <div className="mt-6">
            <h3 className="text-2xl font-bold text-gray-800 mb-2 font-press-start">بازی تمام شد!</h3>
            <button
              onClick={initializeGame}
              className="bg-linear-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white font-bold py-3 px-8 rounded-full transition-all duration-300 transform hover:scale-105 shadow-lg font-press-start"
            >
              بازی دوباره
            </button>
          </div>
        )}

        {showLeaderboard && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white p-4 rounded-lg max-w-sm w-full mx-4">
              <h3 className="text-xl font-bold mb-4 font-press-start">جدول امتیازات</h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left font-press-start">رتبه</th>
                    <th className="text-left font-press-start">نام</th>
                    <th className="text-left font-press-start">امتیاز</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.map((entry, index) => (
                    <tr key={index} className="border-b">
                      <td className="py-1 font-inter">{index + 1}</td>
                      <td className="py-1 font-inter">{entry.displayName}</td>
                      <td className="py-1 font-inter">{entry.highScore}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button onClick={() => setShowLeaderboard(false)} className="mt-4 bg-red-500 text-white px-4 py-2 rounded font-press-start">بستن</button>
            </div>
          </div>
        )}
    </div>

  );
};

const App = () => <ColorGuessingGame />;
export default App;
