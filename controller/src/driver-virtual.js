const Debug = require("debug");

module.exports = async ({ stopPositions }) => {

    function now() {
        return new Date().getTime();
    }

    return {

        async open() {
        },

        async createMotor(name, listener) {
            let log = Debug(`app:motor:${name}`);

            let stopCurrentMove;
            let stepCounter = 0;
            let running = false;

            let stops = {
                lo: {},
                hi: {}
            };

            function doStop() {
                log(`stop`);
                if (stopCurrentMove) {
                    stopCurrentMove();
                }
            }

            function checkStops() {
                for (let side of [{ name: "lo", multiplier: -1 }, { name: "hi", multiplier: 1 }]) {
                    let stop = !!stopPositions && !!stopPositions[name] && isFinite(stopPositions[name][side.name]) && stepCounter * side.multiplier >= stopPositions[name][side.name] * side.multiplier;
                    if (stop && !stops[side.name].stop) {
                        stops[side.name].steps = stepCounter;
                        doStop();
                    }
                    stops[side.name].stop = stop;
                }
            }

            checkStops();

            return {
                name,

                getState() {
                    return {
                        steps: stepCounter,
                        lo: stops.lo,
                        hi: stops.hi,
                        running,
                        currentMA: running? 500: 0
                    }
                },

                async move(steps, timeMs) {

                    let ranToTheEnd = false;

                    if (!running && !(stops.lo.stop && steps < 0) && !(stops.hi.stop && steps > 0)) {

                        running = true;

                        log(`move ${steps} steps in ${timeMs} ms`);

                        let startedAtMs = now();
                        let startedSteps = stepCounter;

                        function update() {
                            if (ranToTheEnd) {
                                stepCounter = Math.round(startedSteps + steps);
                            } else {
                                let actualTimeMs = now() - startedAtMs;
                                stepCounter = startedSteps + Math.ceil(steps * actualTimeMs / timeMs);
                            }

                            checkStops();

                            log(`steps: ${stepCounter}`);
                            listener();
                        }

                        let updateInterval = setInterval(update, 100);

                        try {

                            await new Promise((resolve, reject) => {
                                endTimeout = setTimeout(() => {
                                    clearInterval(updateInterval);
                                    ranToTheEnd = true;
                                    resolve();
                                }, timeMs);
                                stopCurrentMove = () => {
                                    clearInterval(updateInterval);
                                    resolve();
                                };
                            });

                        } finally {
                            running = false;
                            update();
                            log(`move finished`, stepCounter);
                        }
                    }
                },

                stop: doStop
            }
        },

        async createRelay(name, listener) {
            let log = Debug(`app:relay:${name}`);

            let on = false;

            return {
                name,
                getState() {
                    return on;
                },
                async switch(newOn) {
                    log(`switch ${newOn ? "on" : "off"}`);
                    if (newOn !== on) {
                        on = newOn;
                        listener();
                    }
                }
            }
        }

    }

}