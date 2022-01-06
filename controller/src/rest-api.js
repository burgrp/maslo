module.exports = async ({ router }) => {

    async function checkRequest(res, asyncAction) {
        try {
            res.send(await asyncAction());
        } catch (e) {
            res.status(400);
            res.send({ message: e.message || e });
        }
        res.end();
    }

    return {
        start(webapp) {
            // curl -v -X POST -H "content-type:application/octet-stream" --data-binary @test1.nc http://localhost:8080/job
            webapp.post("/job", async (req, res) => {
                await checkRequest(res, async () => {
                    await router.loadJobFromStream(req);
                    return {};
                });
            });

            // curl -v -X DELETE http://localhost:8080/job
            webapp.delete("/job", async (req, res) => {
                await checkRequest(res, async () => {
                    await router.deleteJob();
                    return {};
                });
            });
        }
    };


}