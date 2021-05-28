const Debug = require("debug");

module.exports = async ({ motors }) => {

    function now() {
        return new Date().getTime();
    }

    return {
        async createMotor(name, listener) {
            let log = Debug(`app:motor:${name}`);

            let stopCurrentMove;
            let stepCounter = 0;
            let running = false;

            let lo = {};
            let hi = {};

            function stop() {
                log(`stop`);
                if (stopCurrentMove) {
                    stopCurrentMove();
                }
            }

            function checkStops() {

                let loStop = motors && motors[name] && motors[name].lo && stepCounter <= motors[name].lo;
                if (loStop && !lo.stop) {
                    lo.steps = stepCounter;
                    stop();
                }
                lo.stop = loStop;

                let hiStop = motors && motors[name] && motors[name].lo && stepCounter >= motors[name].hi;
                if (hiStop && !hi.stop) {
                    hi.steps = stepCounter;
                    stop();
                }
                hi.stop = hiStop;
            }

            checkStops();

            return {
                name,

                getState() {
                    return {
                        steps: stepCounter,
                        lo,
                        hi,
                        running
                    }
                },

                async move(steps, timeMs) {

                    let ranToTheEnd = false;

                    if (!running && !(lo.stop && steps < 0) && !(hi.stop && steps > 0)) {

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

                stop
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