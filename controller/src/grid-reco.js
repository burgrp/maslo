module.exports = () => {

    function index(a, b, size, dir) {
        return dir === 0 ? a + b * size : b + a * size;
    }

    function calculateHistogram(image, size, dir) {

        let histogram = new Uint32Array(new ArrayBuffer(size * 4));

        // count histograms sums
        for (let a = 0; a < size; a++) {
            for (let b = 0; b < size; b++) {
                v = image[index(a, b, size, dir)];
                histogram[a] += v;
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
        histogram.avg = sum / size;

        // calculate histogram of histogram
        let hoh = new Uint32Array(new ArrayBuffer(101 * 4));
        for (let i = 0; i <= 100; i++) {
            hoh[histogram[i]]++;
        }
        // identify empty image with noise only
        histogram.clean = hoh.some(v => v > 15) && hoh[0] !== 101;

        // identify flat histogram, find centers of maximum band if any 
        for (let dir = 0; dir <= 1; dir++) {

            let start;
            let stop;

            if (histogram.clean && histogram.avg < 70) {

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

                let loSide = {
                    count: 0,
                    sum: 0
                };
                let hiSide = {
                    count: 0,
                    sum: 0
                };

                for (let i = 0; i < start - size / 10; i++) {
                    loSide.count++;
                    loSide.sum += histogram[i];
                }

                for (let i = stop + size / 10; i < size; i++) {
                    hiSide.count++;
                    hiSide.sum += histogram[i];
                }

                histogram.peak = (start + stop) / 2;

                histogram.sides = Math.sign(Math.round((
                    (loSide.count && loSide.sum / loSide.count) -
                    (hiSide.count && hiSide.sum / hiSide.count)
                ) / 3) * 3) + 1;

            }
        }

        return histogram;
    }

    function recognize(image, size, debug) {

        let t0 = new Date().getTime();

        let histograms = [
            calculateHistogram(image, size, 0),
            calculateHistogram(image, size, 1)
        ];

        let shapes = {
            0: ["northwest", "north", "northeast"],
            1: ["west", "cross", "east", "horizontal"],
            2: ["southwest", "south", "southeast"],
            3: [, "vertical"]
        }

        let result = {
            shape: shapes[histograms[1].sides === undefined ? 3 : histograms[1].sides][histograms[0].sides === undefined ? 3 : histograms[0].sides],
            center: Number.isFinite(histograms[0].peak) || Number.isFinite(histograms[1].peak) ? {
                x: Number.isFinite(histograms[0].peak) ? histograms[0].peak / size : 0.5,
                y: Number.isFinite(histograms[1].peak) ? histograms[1].peak / size : 0.5
            } : undefined
        }

        let t1 = new Date().getTime();

        if (debug) {
            result.debug = {
                timeMs: t1 - t0,
                shape: result.shape,
                center: result.center,
                histograms
            }
        }

        return result;
    }

    return recognize;

}