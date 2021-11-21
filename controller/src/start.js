process.env.DEBUG = process.env.DEBUG || "app:*";

require("@burgrp/appglue")({ require, file: __dirname + "/../appglue.json" }).main(async ({
    webserver,
    router
}) => {
    let webapp = await webserver.start();

    async function checkRequest(res, asyncAction) {
        try {
            res.send(await asyncAction());
        } catch (e) {
            res.status(400);
            res.send({ message: e.message || e });
        }
        res.end();
    }

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

    // setTimeout(async () => {
    //     try {
    //         await router.loadJobFromLocalFile("test1.nc");
    //         await router.runJob();
    //     } catch (e) {
    //         console.error(e);
    //     }
    // }, 1000);

});