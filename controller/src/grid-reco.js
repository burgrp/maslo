module.exports = () => {

    function calculateHistogram({ image, dir, size, shift, depth }) {

        let histogram = new Uint32Array(new ArrayBuffer(size * 4));
        histogram.params = { dir, size, shift, depth };

        // count histograms sums
        for (let i = 0; i < size; i++) {
            for (let d = shift; d < shift + depth; d++) {
                v = image[dir === 0 ? i + d * size : d + i * size];
                histogram[i] += v;
            }
        }

        // normalize to 0..100
        let min;
        let max;
        for (let i = 0; i < size; i++) {
            let v = histogram[i];
            if (min === undefined || min > v) {
                min = v;
            }
            if (max === undefined || max < v) {
                max = v;
            }
        }
        let sum = 0;
        for (let i = 0; i < size; i++) {
            histogram[i] = max === min ? 0 : 100 * (histogram[i] - min) / (max - min);
            sum += histogram[i];
        }
        histogram.avg = sum / depth;

        // calculate histogram of histogram
        let hoh = new Uint32Array(new ArrayBuffer(101 * 4));
        for (let i = 0; i <= 100; i++) {
            hoh[histogram[i]]++;
        }
        // identify empty image with noise only
        let clean = hoh.some(v => v > 10);

        // identify flat histogram, find centers of maximum band if any 

        let start;
        let stop;

        if (clean) {

            for (let i = 0; i < size; i++) {
                let v = histogram[i];
                if (v > (histogram.avg + 100) / 2) {
                    if (start === undefined) {
                        start = i;
                    }
                } else {
                    if (start !== undefined && stop === undefined) {
                        stop = i;
                    }
                }
            }

            histogram.peak = Math.round((start + stop) / 2);
        }

        return histogram;
    }

    function recognize(image, size, debug) {

        let result = {};
        if (debug) {
            result.debug = {
                histograms: []
            };
        }

        let t0 = new Date().getTime();

        let horizontalHistogram = calculateHistogram({ image, size, dir: 0, shift: 0, depth: size });
        let verticalHistogram = calculateHistogram({ image, size, dir: 1, shift: 0, depth: size });

        if (result.debug) {
            result.debug.histograms.push(horizontalHistogram);
            result.debug.histograms.push(verticalHistogram);
        }

        if (horizontalHistogram.peak || verticalHistogram.peak) {
            result.center = {
                x: horizontalHistogram.peak === undefined ? 0.5 : horizontalHistogram.peak / size,
                y: verticalHistogram.peak === undefined ? 0.5 : verticalHistogram.peak / size
            };
        }

        let depth = Math.round(size / 4);

        // histograms for north, east, south, west
        let histograms = [
            calculateHistogram({ image, size, dir: 0, shift: 0, depth }),
            calculateHistogram({ image, size, dir: 1, shift: size - depth, depth }),
            calculateHistogram({ image, size, dir: 0, shift: size - depth, depth }),
            calculateHistogram({ image, size, dir: 1, shift: 0, depth })
        ];

        let index = 0;
        for (let i = 0; i < histograms.length; i++) {
            index |= (histograms[i].peak ? 1 : 0) << (histograms.length - 1 - i);
        }

        result.shape = {
            0b0101: "horizontal",
            0b1010: "vertical",
            0b1100: "northeast",
            0b0110: "southeast",
            0b0011: "southwest",
            0b1001: "northwest",
            0b0111: "north",
            0b1011: "east",
            0b1101: "south",
            0b1110: "west",
            0b1111: "cross"
        }[index];

        if (result.debug) {
            result.debug.histograms.push(...histograms);
        }

        if (result.debug) {
            result.debug.timeMs = new Date().getTime() - t0;
            result.debug.center = result.center;
            result.debug.shape = result.shape;
        }

        return result;
    }

    return recognize;

}