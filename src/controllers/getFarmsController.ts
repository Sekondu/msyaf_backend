import type {Request, Response} from 'express'
import { prisma } from '../config/client'

export const getAllFarms = async (req: Request, res: Response) {
    try{
        const AllFarms = await prisma.farm.findMany({
            include: {
                media: true,
                tiers: true,
            }
        });

        return res.status(200).json(AllFarms);
    }
    catch(err){
        return res.status(500).json(err);
    }
}

export const getFarmById = async (req: Request, res: Response) {
    try{
        const { id } = req.params;

        const farm = await prisma.farm.findFirst({
            where: { id },
            include: {
                media: true,
                tiers: true,
                Bookings: true,
                availablitiy: true,
                busy: true,
            }
        })

        if(!farm) return res.status(404).json({msg: "Farm Not Found"})

        return res.status(200).json(farm)
    }
    catch(err){
        return res.status(500).json(err)
    }
}