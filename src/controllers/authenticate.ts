import type { Request, Response, NextFunction} from 'express'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import prisma from '../config/client'
import { isValidPhoneNumber, parsePhoneNumber, CountryCode } from 'libphonenumber-js'

const JWT_SECRET = process.env["JWT_SECRET"] || 'fallback-secret-key-change-me'

export const login = async (req: Request, res: Response) => {
    try{
        const { phone, password } = req.body

        if(!phone || !password) return res.status(401).json({msg: "Missing Parameters"})

        const user = await prisma.user.findFirst({
            where: {phone}
        })

        if(!user) return res.status(404).json({msg: "User not Found"})

        const match = await bcrypt.compare(password, user.password)

        if(!match) return res.status(401).json({msg: "Incorrect phone or password"})

        const token = jwt.sign({id: user.id}, JWT_SECRET, {expiresIn: '30d'})

        return res.status(200).json({
            msg: "Login successful",
            token
        })
    }
    catch(err){
        return res.status(500).json(err)
    }
}

export const validateToken = async (req: Request, res: Response, next: NextFunction) => {
    try{
        const headers = req.headers;
        if(!headers) return res.status(403).json({msg: "Need Login!"})

        const token = headers.split(' ')[1];

        if(!token) return res.status(403).json({msg: "Token not invoked"})

        const verify = jwt.verify(token, JWT_SECRET)

        if(!verify) return res.status(401).json({msg: "Invalid Token!"})

        next()
    }
    catch(err){

    }
}

export const addUser = async (req: Request, res: Response) => {
    try{
        const { phone,countryCode, password} = req.body

          const targetCountry = countryCode.toUpperCase() as CountryCode 
        
        const isValid = isValidPhoneNumber(phone, targetCountry)
        if (!isValid) {
            return res.status(400).json({ msg: `Invalid phone number format for country ${targetCountry}` })
        }

        const parsed = parsePhoneNumber(phone, targetCountry)
        const standardizedPhone = parsed.format('E.164') 
        const user = await prisma.user.findFirst({
            where: { phone: standardizedPhone }
        })

        if (user) {
            return res.status(401).json({ msg: "User already signed" })
        }

        const hashedPass = await bcrypt.hash(password, 10);

        const added = await prisma.user.create({
            data: {
                phone,
                hashedPass
            }
        })
    }
    catch(err){
        return res.status(500).json(err)
    }
}