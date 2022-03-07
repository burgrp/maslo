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

        if (horizontalHistogram.peak && !verticalHistogram.peak) {
            result.shape = "vertical";
            result.center = {
                x: horizontalHistogram.peak / size,
                y: 0.5
            };
        }

        if (!horizontalHistogram.peak && verticalHistogram.peak) {
            result.shape = "horizontal";
            result.center = {
                x: 0.5,
                y: verticalHistogram.peak / size
            };
        }

        if (horizontalHistogram.peak && verticalHistogram.peak) {

            result.center = {
                x: horizontalHistogram.peak / size,
                y: verticalHistogram.peak / size
            };

            let x = horizontalHistogram.peak;
            let y = verticalHistogram.peak;

            let depth = Math.round(size / 3);


            // histograms for north, east, south, west
            let histograms = [
                calculateHistogram({ image, size, dir: 0, shift: 0, depth}),
                calculateHistogram({ image, size, dir: 1, shift: size - depth, depth}),
                calculateHistogram({ image, size, dir: 0, shift: size - depth, depth}),
                calculateHistogram({ image, size, dir: 1, shift: 0, depth})
            ];

            let index = 0;
            for (let i = 0; i < histograms.length; i++) {
                index |= (histograms[i].peak? 1: 0) << i;
            }

            result.shape  = {
                0b1110: "north",
                0b1101: "east",
                0b1011: "south",
                0b0111: "west",
                0b1111: "cross"
            }[index] || index;

            if (result.debug) {
                result.debug.histograms.push(...histograms);
            }

        }

        // let shapes = {
        //     0: ["northwest", "north", "northeast"],
        //     1: ["west", "cross", "east", "horizontal"],
        //     2: ["southwest", "south", "southeast"],
        //     3: [, "vertical"]
        // }

        // let result = {
        //     shape: shapes[fullHistograms[1].sides === undefined ? 3 : fullHistograms[1].sides][fullHistograms[0].sides === undefined ? 3 : fullHistograms[0].sides],
        //     center: Number.isFinite(fullHistograms[0].peak) || Number.isFinite(fullHistograms[1].peak) ? {
        //         x: Number.isFinite(fullHistograms[0].peak) ? fullHistograms[0].peak / size : 0.5,
        //         y: Number.isFinite(fullHistograms[1].peak) ? fullHistograms[1].peak / size : 0.5
        //     } : undefined
        // }

        if (result.debug) {
            result.debug.timeMs = new Date().getTime() - t0;
            result.debug.center = result.center;
            result.debug.shape = result.shape;
        }

        return result;
    }

    return recognize;

}