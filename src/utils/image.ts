import { imageDir } from "./dir"
import fs from "fs"

export const genImgList: string[] = []

let latestGenImg = ''

// 加载最新生成的图片路径到list中
const loadLatestGenImg = () => {
  const files = fs.readdirSync(imageDir)
  const images = files.filter((file) => /\.(jpg|png)$/.test(file))
    .map((file) => `${imageDir}/${file}`)
  genImgList.push(...images)
}

loadLatestGenImg()

export const setLatestGenImg = (imgPath: string) => {
  genImgList.push(imgPath)
  latestGenImg = imgPath
}

export const getLatestGenImg = () => {
  const img = latestGenImg
  latestGenImg = ''
  return img
}

export const showLatestGenImg = () => {
  if (genImgList.length !== 0) {
    latestGenImg = genImgList[genImgList.length - 1] || ''
    return true
  } else {
    return false
  }
}
