const express = require('express');
const morgan = require('morgan');
const chalk = require('chalk');
const cors = require('cors');
const expressFileUpload = require('express-fileupload');

const app = express();
require('dotenv').config();

var jwt = require('express-jwt');
var jwks = require('jwks-rsa');

const { BlobServiceClient } = require("@azure/storage-blob");
const blobServiceClient = BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);

const port = process.env.PORT || 5000;

app.use(morgan('dev'));
app.use(express.json());
app.use(expressFileUpload({
    preserveExtension: true
}));

app.use(cors());

var jwtCheck = jwt({
    secret: jwks.expressJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 5,
        jwksUri: `${process.env.AUTH0_ISSUER}.well-known/jwks.json`
    }),
    audience: process.env.AUTH0_AUDIENCE,
    issuer: process.env.AUTH0_ISSUER,
    algorithms: ['RS256']
});

app.use(jwtCheck);

app.use((req, res, next) => {
    req.userId = req.user.sub.split("|")[1];
    next();
});

const getFiles = async (container, prefix = null) => {
    const containerClient = blobServiceClient.getContainerClient(container);
    let blobs = []
    for await (const thing of containerClient.listBlobsByHierarchy("/", { prefix })) {
        blobs.push(thing)
    }

    return blobs;
}

// Get files
app.get('/files', async (req, res, next) => {
    try {
        const { prefix } = req.query;

        let blobs = await getFiles(req.userId, prefix)

        res.status(200).json(blobs);
    } catch (err) {
        console.log(err);
        res.status(500).send();
        // TODO: handle errors better later
    }
});

// Download file(s)
app.get('/download', async (req, res, next) => {
    try {
        let container = req.userId; // user's id

        const blobName = JSON.parse(req.query.fileNames)[0];
        // const fileNames = JSON.parse(req.query.fileNames); // TODO: right now only downloading one at a time

        const containerClient = blobServiceClient.getContainerClient(container);
        const blockBlobClient = containerClient.getBlockBlobClient(blobName);

        const blobBuffer = await blockBlobClient.downloadToBuffer(0);

        // let promises = [];

        // for (const fileName of fileNames) {
        //     const containerClient = blobServiceClient.getContainerClient(containerName);
        //     const blockBlobClient = containerClient.getBlockBlobClient(fileName);
        //     promises.push(blockBlobClient.downloadToBuffer(0));
        // }

        // const fileBuffers = await Promise.all(promises);

        // res.status(200).send(fileBuffersfileBuffers);

        res.status(200).send(blobBuffer);
    } catch (err) {
        // TODO: next()
        console.log(err);
    }
});

// Delete Blob(s)
app.delete('/', async (req, res, next) => {
    try {
        const { prefix = "", blobNames } = req.body;
        const container = req.userId;
        const containerClient = blobServiceClient.getContainerClient(container);
        let blockBlobClient;
        let promises = [];

        for (const blobName of blobNames) {
            blockBlobClient = containerClient.getBlockBlobClient(blobName);
            promises.push(blockBlobClient.delete());
        }

        await Promise.all(promises);

        let blobs = await getFiles(container, prefix);
        res.status(200).json(blobs);
    } catch (err) {
        console.log(err);
        res.status(500).send();
    }
});

app.post('/upload', async (req, res, next) => {
    try {
        const { prefix = "" } = req.body;
        const { files } = req;
        const container = req.userId; // user's id
        let blobName;
        let containerClient;
        let blockBlobClient;

        if (Array.isArray(files.uploadFiles)) {
            let promises = [];
            containerClient = blobServiceClient.getContainerClient(container);

            for (const file of files.uploadFiles) {
                blobName = prefix + file.name;
                blockBlobClient = containerClient.getBlockBlobClient(blobName);
                promises.push(blockBlobClient.uploadData(file.data, file.data.length));
            }

            await Promise.all(promises);
        } else {
            blobName = prefix + files.uploadFiles.name;
            containerClient = blobServiceClient.getContainerClient(container);
            blockBlobClient = containerClient.getBlockBlobClient(blobName);

            await blockBlobClient.uploadData(files.uploadFiles.data, files.uploadFiles.data.length);
        }

        let blobs = await getFiles(container, prefix); // TODO: handle prefix of current directory

        res.status(200).json(blobs);
    } catch (err) {
        console.log(err);
        req.status(500).send();
    }
});

// TODO: make 404 route

// TODO: make generic error handler

app.listen(port, () => {
    console.log(`Server running on port ${chalk.blueBright(port)}.`);
});