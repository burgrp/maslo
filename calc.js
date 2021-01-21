let pos1 = { x: 1900, y: 1000 };

let relMove = { x: 500, y: -800 };
let pos2 = { x: pos1.x + relMove.x, y: pos1.y + relMove.y };
//let pos2 = { x: 1500, y: 300 };
let span = 2500;

console.info("Start position", pos1);
console.info("End position", pos2);

let length = pos => ({
    a: Math.sqrt(pos.x * pos.x + pos.y * pos.y),
    b: Math.sqrt((span - pos.x) * (span - pos.x) + pos.y * pos.y)
});

let len1 = length(pos1);
let len2 = length(pos2);

console.info("Start lengths", len1);
console.info("End lengths", len2);

let moves = {
    a: len2.a - len1.a,
    b: len2.b - len1.b
};

console.info("Moves", moves);