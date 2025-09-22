// HTMLのCanvas要素を取得
const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d');

// 定数
const boardWidth = 10;
const boardHeight = 20;
const tetrominoes = [
  // テトリミノの形状を定義
  [
    [0, 0, 1, 0],
    [0, 0, 1, 0],
    [0, 0, 1, 0],
    [0, 0, 1, 0]
  ],
  [
    [0, 1, 0],
    [0, 1, 0],
    [1, 1, 0]
  ],
  // 他のテトリミノの形状も定義
];

// ゲームボード
let gameBoard: number[][] = new Array(boardHeight).fill(0).map(() => new Array(boardWidth).fill(0));

// 現在のテトリミノ
let currentPiece: number[][] = tetrominoes[0];
let currentPieceX = boardWidth / 2 - 2; // 初期位置
let currentPieceY = 0;

// スコア
let score = 0;

// ゲームループ
function gameLoop() {
  update();
  const canvas = document.getElementById("gameCanvas") as HTMLCanvasElement;
  if(canvas) render(canvas.getContext("2d")!);
//  requestAnimationFrame(gameLoop);
}

// 更新関数
function update() {
  // 重力: 毎フレーム、テトリミノを1つ下に移動
  currentPieceY++;

  // 衝突検出
  if (isColliding(currentPiece, currentPieceX, currentPieceY)) {
    currentPieceY--; // 衝突したので元に戻す
    currentPiece = tetrominoes[Math.floor(Math.random() * tetrominoes.length)];
    currentPieceX = boardWidth / 2 - 2;
    currentPieceY = 0;

    // 固定された行を削除し、スコアを計算
    score += removeCompleteLines();
  }
}

// 入力処理
document.addEventListener('keydown', (event) => {
  switch (event.key) {
    case 'ArrowLeft':
      currentPieceX--;
      break;
    case 'ArrowRight':
      currentPieceX++;
      break;
    case 'ArrowDown':
      currentPieceY++;
      break;
    case ' ':
      rotatePiece();
      break;
  }
  // 衝突検出を再度実行して、移動後の衝突を確認
  if (isColliding(currentPiece, currentPieceX, currentPieceY)) {
    // 衝突したら元に戻す
    currentPieceX -= event.key === 'ArrowLeft' ? 1 : -1;
    currentPieceY -= event.key === 'ArrowDown' ? 1 : 0;
  }
});

// テトリミノの回転
function rotatePiece() {
  const newPiece = rotate(currentPiece);
  if (!isColliding(newPiece, currentPieceX, currentPieceY)) {
    currentPiece = newPiece;
  }
}

// テトリミノの回転ロジック
function rotate(piece: number[][]): number[][] {
  const rotatedPiece: number[][] = new Array(piece[0].length).fill(0).map(() => new Array(piece.length).fill(0));
  for (let i = 0; i < piece.length; i++) {
    for (let j = 0; j < piece[i].length; j++) {
      rotatedPiece[j][piece.length - 1 - i] = piece[i][j];
    }
  }
  return rotatedPiece;
}

// 衝突検出関数
function isColliding(piece: number[][], x: number, y: number): boolean {
  for (let i = 0; i < piece.length; i++) {
    for (let j = 0; j < piece[i].length; j++) {
      if (piece[i][j] !== 0 && (y + i >= boardHeight || x + j < 0 || x + j >= boardWidth || gameBoard[y + i][x + j] !== 0)) {
        return true;
      }
    }
  }
  return false;
}

// 行の削除とスコア計算
function removeCompleteLines(): number {
  let linesCleared = 0;
  for (let i = boardHeight - 1; i >= 0; i--) {
    let isComplete = true;
    for (let j = 0; j < boardWidth; j++) {
      if (gameBoard[i][j] === 0) {
        isComplete = false;
        break;
      }
    }
    if (isComplete) {
      gameBoard.splice(i, 1);
      gameBoard.unshift(new Array(boardWidth).fill(0));
      linesCleared++;
    }
  }
  return linesCleared * 10; // スコア計算 (1行につき10点)
}

// レンダリング関数
function render(ctx: CanvasRenderingContext2D) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // スコアの描画
  ctx.font = '16px Arial';
  ctx.fillText('Score: ' + score, 10, 20);

  // ゲームボードの描画
  for (let i = 0; i < boardHeight; i++) {
    for (let j = 0; j < boardWidth; j++) {
      if (gameBoard[i][j] !== 0) {
        ctx.fillStyle = 'blue'; // ブロックの色
        ctx.fillRect(j * 20, i * 20, 20, 20);
      }
    }
  }

  // 現在のテトリミノの描画
  for (let i = 0; i < currentPiece.length; i++) {
    for (let j = 0; j < currentPiece[i].length; j++) {
      if (currentPiece[i][j] !== 0) {
        ctx.fillStyle = 'red'; // テトリミノの色
        ctx.fillRect((currentPieceX + j) * 20, (currentPieceY + i) * 20, 20, 20);
      }
    }
  }
}

// ゲームループを開始
setInterval(gameLoop, 500);