const Debug = require("debug");

module.exports = async ({ stopPositions }) => {

    function now() {
        return new Date().getTime();
    }

    return {

        async open() {
        },

        async createMotor(name, state) {

            state.steps = 0;
            state.lo = {};
            state.hi = {};
            state.running = false;

            let log = Debug(`app:motor:${name}`);

            let stopCurrentMove;

            function doStop() {
                log(`stop`);
                if (stopCurrentMove) {
                    stopCurrentMove();
                }
            }

            function checkStops() {
                for (let side of [{ name: "lo", multiplier: -1 }, { name: "hi", multiplier: 1 }]) {
                    let stop = !!stopPositions && !!stopPositions[name] && isFinite(stopPositions[name][side.name]) && state.steps * side.multiplier >= stopPositions[name][side.name] * side.multiplier;
                    if (stop && !state[side.name].stop) {
                        state[side.name].steps = state.steps;
                        doStop();
                    }
                    state[side.name].stop = stop;
                }
            }

            checkStops();

            return {
                name,

                async move(steps, timeMs) {

                    let ranToTheEnd = false;

                    if (!state.running && !(state.lo.stop && steps < 0) && !(state.hi.stop && steps > 0)) {

                        state.running = true;

                        log(`move ${steps} steps in ${timeMs} ms`);

                        let startedAtMs = now();
                        let startedSteps = state.steps;

                        function update() {
                            if (ranToTheEnd) {
                                state.steps = Math.round(startedSteps + steps);
                            } else {
                                let actualTimeMs = now() - startedAtMs;
                                state.steps = startedSteps + Math.ceil(steps * actualTimeMs / timeMs);
                            }

                            checkStops();

                            state.currentMA = state.running? 500: 0;

                            log(`steps: ${state.steps}`);
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
                            state.running = false;
                            update();
                            log(`move finished`, state.steps);
                        }
                    }
                },

                stop: doStop
            }
        },

        async createRelay(name, state) {
            let log = Debug(`app:relay:${name}`);

            state.on = false;

            return {
                name,
                async switch(newOn) {
                    log(`switch ${newOn ? "on" : "off"}`);
                    state.on = newOn;
                }
            }
        }

    }

}