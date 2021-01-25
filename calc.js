let pos1 = { x: -1000, y: 700 };

// let relMove = { x: 500, y: -800 };
// let pos2 = { x: pos1.x + relMove.x, y: pos1.y + relMove.y };
let pos2 = { x: 800, y: 1500 };
let span = 3500;

console.info("Start position", pos1);
console.info("End position", pos2);

let base = (a, b) => Math.sqrt(a * a + b * b);
//let arm = (c, a) => Math.sqrt(c * c - a * a);

let length = pos => ({
    a: base(span / 2 - pos.x, pos.y),
    b: base(span / 2 + pos.x, pos.y)
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


