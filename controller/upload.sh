#!/bin/sh
curl -v -X POST -H "content-type:application/octet-stream" --data-binary @$1 http://localhost:8080/job
