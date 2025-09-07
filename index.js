
  // ===================== Chess Logic & UI (Vanilla JS) =====================
  // Pieces encoded as: 'P','N','B','R','Q','K' for white; lowercase for black
  const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  const grid = document.getElementById('grid');
  const boardEl = document.getElementById('board');
  const statusEl = document.getElementById('status');
  const moveListEl = document.getElementById('moveList');
  const turnLabel = document.getElementById('turnLabel');
  const fenBox = document.getElementById('fenBox');
  const pgnBox = document.getElementById('pgnBox');
  const vsAIChk = document.getElementById('vsAI');
  const sideBadge = document.getElementById('sideBadge');
  const promoDlg = document.getElementById('promoDlg');
  const promoGrid = document.getElementById('promoGrid');

  let board = new Array(64).fill(null);
  let whiteToMove = true;
  let castling = {K:true, Q:true, k:true, q:true};
  let enPassant = -1; // square index
  let halfmove = 0, fullmove = 1;
  let moveHistory = []; // stores move objects + snapshots
  let selected = -1; // square index
  let highlights = new Set();
  let flip = false; // board orientation
  let pgnMoves = [];

  const unicode = {
    'P':'♙','N':'♘','B':'♗','R':'♖','Q':'♕','K':'♔',
    'p':'♟','n':'♞','b':'♝','r':'♜','q':'♛','k':'♚'
  };

  const files = ['a','b','c','d','e','f','g','h'];

  function idx(file, rank){ return rank*8 + file; } // 0..63
  function fr(i){ return [i%8, Math.floor(i/8)]; }
  function onBoard(f,r){ return f>=0 && f<8 && r>=0 && r<8; }
  function isWhite(p){ return p && p===p.toUpperCase(); }
  function isBlack(p){ return p && p===p.toLowerCase(); }
  function sideToMove(){ return whiteToMove ? 'w':'b'; }

  function parseFEN(fen){
    const [pieces, side, castle, ep, hm, fm] = fen.trim().split(/\s+/);
    board.fill(null); let i=0;
    for(const ch of pieces){
      if(ch==='/' ) continue;
      if(/[1-8]/.test(ch)){ i+= parseInt(ch,10); continue; }
      board[i++] = ch;
    }
    whiteToMove = (side==='w');
    castling = {K:false,Q:false,k:false,q:false};
    if(castle && castle!=='-') for(const c of castle) castling[c]=true;
    enPassant = ep==='-' ? -1 : algebraicToIdx(ep);
    halfmove = parseInt(hm||'0',10); fullmove=parseInt(fm||'1',10);
  }

  function makeFEN(){
    let rows=[];
    for(let r=7;r>=0;r--){
      let row='', empty=0;
      for(let f=0;f<8;f++){
        const p = board[idx(f,r)];
        if(!p){ empty++; }
        else { if(empty){ row+=empty; empty=0;} row+=p; }
      }
      if(empty) row+=empty; rows.push(row);
    }
    const castleStr = ['K','Q','k','q'].filter(c=>castling[c]).join('')||'-';
    const epStr = enPassant===-1?'-':idxToAlgebraic(enPassant);
    return `${rows.join('/') } ${whiteToMove?'w':'b'} ${castleStr} ${epStr} ${halfmove} ${fullmove}`;
  }

  function idxToAlgebraic(i){ const [f,r]=fr(i); return files[f]+(r+1); }
  function algebraicToIdx(s){ const f = files.indexOf(s[0]); const r = parseInt(s[1])-1; return idx(f,r); }

  // -------- Rendering --------
  function render(){
    grid.innerHTML='';
    const squares = [];
    for(let r=7;r>=0;r--){
      for(let f=0;f<8;f++){
        const rr = flip? 7-r : r;
        const ff = flip? 7-f : f;
        const i = idx(ff, rr);
        const s = document.createElement('div');
        s.className = 'sq ' + ((f+r)%2===0? 'light':'dark');
        s.dataset.index = i;

        // highlights
        if(i===selected) s.classList.add('hl-move');
        if(highlights.has(i)) s.classList.add('hl-target');

        const p = board[i];
        if(p){
          const span = document.createElement('div');
          span.className='piece ' + (isWhite(p)?'white':'black');
          span.textContent = unicode[p];
          s.appendChild(span);
        }
        // coordinates
        if((!flip && r===0) || (flip && r===7)){
          const c = document.createElement('div');
          c.className='sq coord'; c.textContent=files[f]; s.appendChild(c);
        }
        if((!flip && f===0) || (flip && f===7)){
          const c2 = document.createElement('div');
          c2.className='sq coord'; c2.style.left='auto'; c2.style.right='6px'; c2.textContent=(r+1);
          s.appendChild(c2);
        }

        s.addEventListener('click', onSquareClick);
        grid.appendChild(s); squares.push(s);
      }
    }

    // in-check highlight
    const kSq = findKing(whiteToMove);
    if(isSquareAttacked(kSq, !whiteToMove)){
      [...grid.children].forEach(el=>{ if(+el.dataset.index===kSq) el.classList.add('in-check'); });
    }

    turnLabel.textContent = whiteToMove? 'White to move':'Black to move';
    fenBox.textContent = makeFEN();
    pgnBox.textContent = formatPGN();
    updateMoveList();
    updateStatus();
  }

  function onSquareClick(e){
    const i = +e.currentTarget.dataset.index;
    const p = board[i];
    if(selected===-1){
      if(!p) return; // empty
      if( (whiteToMove && !isWhite(p)) || (!whiteToMove && !isBlack(p)) ) return;
      selected = i; highlights = new Set(legalMovesFrom(i).map(m=>m.to));
      render();
    } else {
      const moves = legalMovesFrom(selected);
      const mv = moves.find(m=>m.to===i);
      if(mv){
        doMove(mv);
        selected = -1; highlights.clear();
        render();
        maybeAIMove();
      } else {
        // reselect if own piece
        if(p && ((whiteToMove && isWhite(p)) || (!whiteToMove && isBlack(p)))){
          selected = i; highlights = new Set(legalMovesFrom(i).map(m=>m.to));
        } else { selected = -1; highlights.clear(); }
        render();
      }
    }
  }

  // -------- Move generation --------
  const knightD = [[1,2],[2,1],[-1,2],[-2,1],[1,-2],[2,-1],[-1,-2],[-2,-1]];
  const kingD = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]];

  function findKing(white){
    const target = white? 'K':'k';
    for(let i=0;i<64;i++) if(board[i]===target) return i; return -1;
  }

  function legalMovesFrom(i){
    const p = board[i]; if(!p) return [];
    const colorWhite = isWhite(p);
    const pseudo = [];
    const [f,r] = fr(i);
    if(p.toUpperCase()==='P'){
      const dir = colorWhite? 1:-1;
      const startRank = colorWhite? 1:6;
      // single push
      if(onBoard(f,r+dir) && !board[idx(f,r+dir)]){
        pseudo.push(mv(i, idx(f,r+dir)));
        // double
        if(r===startRank && !board[idx(f,r+2*dir)]) pseudo.push(mv(i, idx(f,r+2*dir), {epSet: idx(f,r+dir)}));
      }
      // captures
      for(const df of [-1,1]){
        if(onBoard(f+df,r+dir)){
          const t=idx(f+df,r+dir);
          if(board[t] && (colorWhite? isBlack(board[t]):isWhite(board[t]))) pseudo.push(mv(i,t));
        }
      }
      // en passant capture
      if(enPassant!==-1 && Math.abs(fr(enPassant)[0]-f)===1 && fr(enPassant)[1]===r+dir){
        pseudo.push(mv(i, enPassant, {enPassant:true}));
      }
    }
    else if(p.toUpperCase()==='N'){
      for(const [df,dr] of knightD){ const ff=f+df, rr=r+dr; if(!onBoard(ff,rr)) continue; const t=idx(ff,rr); if(!board[t]|| (colorWhite? isBlack(board[t]):isWhite(board[t]))) pseudo.push(mv(i,t)); }
    }
    else if(p.toUpperCase()==='B' || p.toUpperCase()==='R' || p.toUpperCase()==='Q'){
      const dirs = [];
      if(p.toUpperCase()!=='R'){ dirs.push([1,1],[-1,1],[1,-1],[-1,-1]); }
      if(p.toUpperCase()!=='B'){ dirs.push([1,0],[-1,0],[0,1],[0,-1]); }
      for(const [df,dr] of dirs){ let ff=f+df, rr=r+dr; while(onBoard(ff,rr)){ const t=idx(ff,rr); if(!board[t]){ pseudo.push(mv(i,t)); } else { if(colorWhite? isBlack(board[t]):isWhite(board[t])) pseudo.push(mv(i,t)); break; } ff+=df; rr+=dr; }
      }
    }
    else if(p.toUpperCase()==='K'){
      for(const [df,dr] of kingD){ const ff=f+df, rr=r+dr; if(!onBoard(ff,rr)) continue; const t=idx(ff,rr); if(!board[t]|| (colorWhite? isBlack(board[t]):isWhite(board[t]))) pseudo.push(mv(i,t)); }
      // castling
      if(colorWhite){
        if(castling.K && !board[idx(5,0)] && !board[idx(6,0)] && !isSquareAttacked(idx(4,0),false) && !isSquareAttacked(idx(5,0),false) && !isSquareAttacked(idx(6,0),false)) pseudo.push(mv(i, idx(6,0), {castle:'K'}));
        if(castling.Q && !board[idx(3,0)] && !board[idx(2,0)] && !board[idx(1,0)] && !isSquareAttacked(idx(4,0),false) && !isSquareAttacked(idx(3,0),false) && !isSquareAttacked(idx(2,0),false)) pseudo.push(mv(i, idx(2,0), {castle:'Q'}));
      } else {
        if(castling.k && !board[idx(5,7)] && !board[idx(6,7)] && !isSquareAttacked(idx(4,7),true) && !isSquareAttacked(idx(5,7),true) && !isSquareAttacked(idx(6,7),true)) pseudo.push(mv(i, idx(6,7), {castle:'k'}));
        if(castling.q && !board[idx(3,7)] && !board[idx(2,7)] && !board[idx(1,7)] && !isSquareAttacked(idx(4,7),true) && !isSquareAttacked(idx(3,7),true) && !isSquareAttacked(idx(2,7),true)) pseudo.push(mv(i, idx(2,7), {castle:'q'}));
      }
    }

    // filter illegal (leave king in check)
    const legal = [];
    for(const m of pseudo){
      const snap = snapshot();
      applyMove(m);
      const kSq = findKing(colorWhite);
      if(!isSquareAttacked(kSq, !colorWhite)) legal.push(m);
      restore(snap);
    }

    // promotions mark
    for(const m of legal){
      const [tf,tr]=fr(m.to);
      const pp = board[m.from];
      if(pp && pp.toUpperCase()==='P'){
        if((isWhite(pp) && tr===7) || (isBlack(pp) && tr===0)) m.promotion = 'Q'; // default; UI will ask
      }
    }

    return legal;
  }

  function mv(from, to, extra={}){ return {from,to, ...extra}; }

  function isSquareAttacked(square, byWhite){
    // pawns
    const [f,r]=fr(square);
    const dir = byWhite? 1:-1;
    for(const df of [-1,1]){
      const ff=f+df, rr=r-dir; // because looking from attackers perspective
      if(onBoard(ff,rr)){
        const p=board[idx(ff,rr)];
        if(p && (byWhite? p==='P':p==='p')) return true;
      }
    }
    // knights
    for(const [df,dr] of knightD){ const ff=f+df, rr=r+dr; if(onBoard(ff,rr)){ const p=board[idx(ff,rr)]; if(p && (byWhite? p==='N':p==='n')) return true; } }
    // bishops / queens (diagonals)
    for(const [df,dr] of [[1,1],[-1,1],[1,-1],[-1,-1]]){ let ff=f+df, rr=r+dr; while(onBoard(ff,rr)){ const p=board[idx(ff,rr)]; if(p){ if(byWhite? (p==='B'||p==='Q'): (p==='b'||p==='q')) return true; break;} ff+=df; rr+=dr; }
    }
    // rooks / queens (orthogonal)
    for(const [df,dr] of [[1,0],[-1,0],[0,1],[0,-1]]){ let ff=f+df, rr=r+dr; while(onBoard(ff,rr)){ const p=board[idx(ff,rr)]; if(p){ if(byWhite? (p==='R'||p==='Q'): (p==='r'||p==='q')) return true; break;} ff+=df; rr+=dr; }
    }
    // kings
    for(const [df,dr] of kingD){ const ff=f+df, rr=r+dr; if(onBoard(ff,rr)){ const p=board[idx(ff,rr)]; if(p && (byWhite? p==='K':p==='k')) return true; } }
    return false;
  }

  function snapshot(){
    return {board:[...board], whiteToMove, castling:{...castling}, enPassant, halfmove, fullmove};
  }
  function restore(s){ board=[...s.board]; whiteToMove=s.whiteToMove; castling={...s.castling}; enPassant=s.enPassant; halfmove=s.halfmove; fullmove=s.fullmove; }

  function applyMove(m){
    const p = board[m.from];
    const target = board[m.to];

    // halfmove clock
    if(p.toUpperCase()==='P' || target) halfmove=0; else halfmove++;

    // en passant capture
    if(m.enPassant){ const [tf,tr]=fr(m.to); const capIdx = idx(tf, tr + (isWhite(p)?-1:1)); board[capIdx]=null; }

    // castling: move rook
    if(m.castle){
      if(m.castle==='K'){ board[idx(5,0)] = 'R'; board[idx(7,0)] = null; }
      if(m.castle==='Q'){ board[idx(3,0)] = 'R'; board[idx(0,0)] = null; }
      if(m.castle==='k'){ board[idx(5,7)] = 'r'; board[idx(7,7)] = null; }
      if(m.castle==='q'){ board[idx(3,7)] = 'r'; board[idx(0,7)] = null; }
    }

    // move piece
    board[m.to] = p;
    board[m.from] = null;

    // promotion
    if(m.promoteChoice){ board[m.to] = isWhite(p)? m.promoteChoice : m.promoteChoice.toLowerCase(); }

    // update castling rights when rook/king moves or captured
    if(p==='K'){ castling.K=false; castling.Q=false; }
    if(p==='k'){ castling.k=false; castling.q=false; }
    if(m.from===idx(0,0) || m.to===idx(0,0)) castling.Q=false;
    if(m.from===idx(7,0) || m.to===idx(7,0)) castling.K=false;
    if(m.from===idx(0,7) || m.to===idx(0,7)) castling.q=false;
    if(m.from===idx(7,7) || m.to===idx(7,7)) castling.k=false;

    enPassant = m.epSet ?? -1;

    if(!whiteToMove) fullmove++;
    whiteToMove = !whiteToMove;
  }

  function doMove(m){
    // Ask for promotion choice if needed
    const p = board[m.from];
    if(p && p.toUpperCase()==='P'){
      const [,tr]=fr(m.to);
      const need = (isWhite(p) && tr===7) || (isBlack(p) && tr===0);
      if(need){
        m.promoteChoice = promptPromotion(isWhite(p));
      }
    }
    const before = snapshot();
    applyMove(m);

    const san = moveToSAN(before, m);
    pgnMoves.push(san);

    moveHistory.push({m, before});
  }

  function undo(){ if(moveHistory.length===0) return; const last = moveHistory.pop(); restore(last.before); pgnMoves.pop(); render(); }

  // -------- SAN / PGN --------
  function formatPGN(){
    let out=''; let moveNo=1; for(let i=0;i<pgnMoves.length;i+=2){ out += `${moveNo}. ${pgnMoves[i]||''} ${pgnMoves[i+1]||''} `; moveNo++; }
    return out.trim();
  }

  function moveToSAN(stateBefore, m){
    const piece = stateBefore.board[m.from];
    const isCap = !!stateBefore.board[m.to] || m.enPassant;
    // clone to see if it was a check/mate
    const tmp = { ...stateBefore, board:[...stateBefore.board], castling:{...stateBefore.castling} };
    let promo = '';
    if(piece.toUpperCase()==='P'){
      const [,tr]=fr(m.to);
      if((isWhite(piece) && tr===7) || (isBlack(piece) && tr===0)){
        promo = '=' + (m.promoteChoice||'Q').toUpperCase();
      }
    }
    // Castling SAN
    if(m.castle){ return (m.to%8===6) ? 'O-O' : 'O-O-O'; }
    // Disambiguation for pieces (not for pawns)
    let name = piece.toUpperCase()==='P'? '' : piece.toUpperCase();
    if(name){
      const samePiece = [];
      for(let s=0;s<64;s++){
        if(s===m.from) continue;
        const p2 = stateBefore.board[s];
        if(p2 && p2.toUpperCase()===name && (isWhite(p2)===isWhite(piece))){
          // can s also move to m.to?
          const save = {board:[...stateBefore.board], whiteToMove:stateBefore.whiteToMove, castling:{...stateBefore.castling}, enPassant:stateBefore.enPassant};
          board=[...stateBefore.board]; whiteToMove=stateBefore.whiteToMove; castling={...stateBefore.castling}; enPassant=stateBefore.enPassant;
          const alt = legalMovesFrom(s).some(x=>x.to===m.to);
          // restore temp board
          board=[...save.board]; whiteToMove=save.whiteToMove; castling={...save.castling}; enPassant=save.enPassant;
          if(alt) samePiece.push(s);
        }
      }
      if(samePiece.length){ const [ff,rf]=fr(m.from); const needFile = samePiece.some(s=>fr(s)[0]!==ff); const needRank = samePiece.some(s=>fr(s)[1]!==rf); if(needFile) name += files[ff]; else if(needRank) name += (rf+1); }
    }
    const capture = isCap? (piece.toUpperCase()==='P'? files[fr(m.from)[0]] + 'x' : 'x') : '';
    const dest = idxToAlgebraic(m.to);

    // Determine check/mate sign
    let checkSign = '';
    // simulate
    board=[...stateBefore.board]; whiteToMove=stateBefore.whiteToMove; castling={...stateBefore.castling}; enPassant=stateBefore.enPassant;
    applyMove({...m});
    const oppInCheck = isSquareAttacked(findKing(!stateBefore.whiteToMove), stateBefore.whiteToMove);
    const noReply = generateAllLegalMoves().length===0;
    checkSign = oppInCheck ? (noReply ? '#' : '+') : '';
    // restore
    restore(stateBefore);

    return `${name}${capture}${dest}${promo}${checkSign}`;
  }

  function generateAllLegalMoves(){
    const moves=[]; for(let i=0;i<64;i++){ const p=board[i]; if(!p) continue; if((whiteToMove && isWhite(p))||(!whiteToMove && isBlack(p))) moves.push(...legalMovesFrom(i)); } return moves;
  }

  function updateMoveList(){
    moveListEl.innerHTML='';
    let ply=0, row;
    pgnMoves.forEach((mv,i)=>{
      if(i%2===0){ row = document.createElement('div'); row.className='row'; const no = Math.floor(i/2)+1; row.innerHTML = `<div style="width:24px;color:#cbd5e1">${no}.</div>`; moveListEl.appendChild(row); }
      const b = document.createElement('div'); b.className='badge'; b.textContent=mv; row.appendChild(b); ply++;
    });
    moveListEl.scrollTop = moveListEl.scrollHeight;
  }

  function updateStatus(){
    const legal = generateAllLegalMoves();
    const inCheck = isSquareAttacked(findKing(whiteToMove), !whiteToMove);
    if(legal.length===0){ statusEl.textContent = inCheck? (whiteToMove? 'Checkmate — Black wins':'Checkmate — White wins') : 'Stalemate'; return; }
    if(halfmove>=100) { statusEl.textContent='Draw — 50-move rule'; return; }
    statusEl.textContent = inCheck? 'Check!' : 'Playing';
  }

  // -------- Simple AI (minimax + alpha-beta, depth 2-3) --------
  const pieceValue = {P:100,N:320,B:330,R:500,Q:900,K:20000};
  // Simple piece-square tables (middlegame-ish)
  const PST = {
    P:[
      0,0,0,0,0,0,0,0,
      50,50,50,50,50,50,50,50,
      10,10,20,30,30,20,10,10,
      5,5,10,25,25,10,5,5,
      0,0,0,20,20,0,0,0,
      5,-5,-10,0,0,-10,-5,5,
      5,10,10,-20,-20,10,10,5,
      0,0,0,0,0,0,0,0
    ],
    N:[
      -50,-40,-30,-30,-30,-30,-40,-50,
      -40,-20,0,0,0,0,-20,-40,
      -30,0,10,15,15,10,0,-30,
      -30,5,15,20,20,15,5,-30,
      -30,0,15,20,20,15,0,-30,
      -30,5,10,15,15,10,5,-30,
      -40,-20,0,5,5,0,-20,-40,
      -50,-40,-30,-30,-30,-30,-40,-50
    ],
    B:[
      -20,-10,-10,-10,-10,-10,-10,-20,
      -10,5,0,0,0,0,5,-10,
      -10,10,10,10,10,10,10,-10,
      -10,0,10,10,10,10,0,-10,
      -10,5,5,10,10,5,5,-10,
      -10,0,5,10,10,5,0,-10,
      -10,0,0,0,0,0,0,-10,
      -20,-10,-10,-10,-10,-10,-10,-20
    ],
    R:[
      0,0,0,5,5,0,0,0,
      -5,0,0,0,0,0,0,-5,
      -5,0,0,0,0,0,0,-5,
      -5,0,0,0,0,0,0,-5,
      -5,0,0,0,0,0,0,-5,
      -5,0,0,0,0,0,0,-5,
      5,10,10,10,10,10,10,5,
      0,0,0,0,0,0,0,0
    ],
    Q:[
      -20,-10,-10,-5,-5,-10,-10,-20,
      -10,0,5,0,0,0,0,-10,
      -10,5,5,5,5,5,0,-10,
      0,0,5,5,5,5,0,-5,
      -5,0,5,5,5,5,0,-5,
      -10,0,5,5,5,5,0,-10,
      -10,0,0,0,0,0,0,-10,
      -20,-10,-10,-5,-5,-10,-10,-20
    ],
    K:[
      20,30,10,0,0,10,30,20,
      20,20,0,0,0,0,20,20,
      -10,-20,-20,-20,-20,-20,-20,-10,
      -20,-30,-30,-40,-40,-30,-30,-20,
      -30,-40,-40,-50,-50,-40,-40,-30,
      -30,-40,-40,-50,-50,-40,-40,-30,
      -30,-40,-40,-50,-50,-40,-40,-30,
      -30,-40,-40,-50,-50,-40,-40,-30
    ]
  };

  function evaluate(){
    let score=0;
    for(let i=0;i<64;i++){
      const p=board[i]; if(!p) continue;
      const base = pieceValue[p.toUpperCase()];
      const pst = PST[p.toUpperCase()][isWhite(p)? i : 63-i];
      score += (isWhite(p)? 1:-1) * (base + pst);
    }
    return whiteToMove? score : -score; // from side to move perspective
  }

  function minimax(depth, alpha, beta){
    if(depth===0) return {score:evaluate()};
    const moves = generateAllLegalMoves();
    if(moves.length===0){ // checkmate or stalemate
      const inCheck = isSquareAttacked(findKing(whiteToMove), !whiteToMove);
      return {score: inCheck? -99999 + (3-depth) : 0};
    }
    let best=null;
    for(const m of moves){
      const snap=snapshot();
      applyMove(m);
      const s = -minimax(depth-1, -beta, -alpha).score; // negamax
      restore(snap);
      if(!best || s>best.score){ best={score:s, move:m}; }
      alpha = Math.max(alpha, s);
      if(alpha>=beta) break; // prune
    }
    return best;
  }

  async function maybeAIMove(){
    if(!vsAIChk.checked) return;
    const humanIsWhite = sideBadge.textContent.includes('White');
    const aiPlaysNow = (whiteToMove && !humanIsWhite) || (!whiteToMove && humanIsWhite);
    if(!aiPlaysNow) return;
    // small delay for UX
    await new Promise(r=>setTimeout(r, 180));
    const depth = 2; // safe & quick
    const {move} = minimax(depth, -1e9, 1e9);
    if(move){ doMove(move); render(); }
  }

  function promptPromotion(white){
    return new Promise((resolve)=>{
      promoGrid.innerHTML='';
      const opts = ['Q','R','B','N'];
      for(const o of opts){
        const d=document.createElement('div'); d.className='promo-item'; d.textContent = unicode[white? o : o.toLowerCase()];
        d.addEventListener('click', ()=>{ promoDlg.close(); resolve(o); });
        promoGrid.appendChild(d);
      }
      promoDlg.addEventListener('close', ()=>{ if(promoDlg.returnValue===''){} });
      promoDlg.showModal();
    });
  }

  // Overload doMove to await promotion promise if needed
  const _doMove = doMove;
  doMove = async function(m){
    const p = board[m.from];
    if(p && p.toUpperCase()==='P'){
      const [,tr]=fr(m.to);
      const need = (isWhite(p) && tr===7) || (isBlack(p) && tr===0);
      if(need && !m.promoteChoice){ m.promoteChoice = await promptPromotion(isWhite(p)); }
    }
    const before = snapshot();
    applyMove(m);
    const san = moveToSAN(before, m);
    pgnMoves.push(san);
    moveHistory.push({m, before});
  }

  // -------- Controls --------
  document.getElementById('btnNew').onclick = ()=>{ loadFEN(START_FEN); moveHistory=[]; pgnMoves=[]; render(); };
  document.getElementById('btnUndo').onclick = ()=>{ undo(); };
  document.getElementById('btnFlip').onclick = ()=>{ flip=!flip; render(); };
  document.getElementById('btnAIMove').onclick = ()=>{ maybeAIMove(); };
  document.getElementById('btnCopyFEN').onclick = ()=>{ navigator.clipboard.writeText(makeFEN()); };
  document.getElementById('btnLoadFEN').onclick = ()=>{
    const fen = prompt('Paste FEN:'); if(fen){ try{ loadFEN(fen); moveHistory=[]; pgnMoves=[]; render(); } catch(e){ alert('Invalid FEN'); } }
  };
  vsAIChk.onchange = ()=>{ statusEl.textContent = vsAIChk.checked? 'Playing vs Computer' : 'Two-Player (Local)'; maybeAIMove(); };

  function loadFEN(f){ parseFEN(f); }

  // Init
  loadFEN(START_FEN);
  render();

 
