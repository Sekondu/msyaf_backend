import express, {Request, Response} from 'express'
import {getAllFarms, getFarmById} from './controllers/getFarmsController'
const app = express()

app.use(express.json())

app.get("/farms", getAllFarms)
app.get("/farms/:id", getFarmById)

app.listen(3000, () => console.log("listening"))