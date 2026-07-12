import type { Request, Response } from 'express'
import {prisma} from '../config/client'
import { status_details } from '../generated/prisma/enums'

//for listers or people with accounts
export const getAllBookings = async (req: Request, res: Response) => {
    try{
        const { id } = req.params;

        const allBookings = await prisma.bookingRequest.findMany({
            where: {user_id: id}
        })
    }
    catch(err){
        return res.status(500).json(err)
    }
}

//this is done by visitors of the site and they get confirmation msg on whatsapp
export const createBookingRequest = async (req: Request, res: Response) => {
    try{
    const {farmId, name, phone, people, month, day, notes} = req.body

    const farm = await prisma.farm.findFirst({
        where: {id : farmId}
    })

    if(!farm) return res.status(404).json({ msg: "Farm not Found"})

    const newRequest = await prisma.bookingRequest.create({
        data: {
            user_id: farm.owner_id,
            farm_id: farmId,
            name,
            phone,
            no_people: people,
            month,
            day,
            status: status_details.pending,
            notes
        }
    })

    return res.status(200).json({msg: "Booking Noted"})
    }
    catch(err){
        return res.status(500).json(err)
    }
}

export const updateBooking = async (req: Request, res: Response) => {
    try{
        const { id, approved, bookingId } = req.body;

        const checkBooking = await prisma.bookingRequest.findFirst({
            where: { id: bookingId ,user_id: id}
        })

        if(!checkBooking) return res.status(404).json({msg: "Booking Not Found"})

        const status = approved === true ? status_details.approved : status_details.rejected

        const updated = await prisma.bookingRequest.update({
            where: {id: bookingId, user_id: id},
            data: {
                status
            }
        })

        return res.status(200).json(updated)
    }
    catch(err){
        return res.status(500).json(err)
    }
}