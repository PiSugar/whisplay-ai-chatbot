import { imageDir, cameraDir } from "./dir";
import fs from "fs";
import path from "path";

export const genImgList: string[] = [];
export const capturedImgList: string[] = [];

let latestDisplayImg = "";

// 加载最新生成的图片路径到list中
const loadLatestGenImg = () => {
  const files = fs.readdirSync(imageDir);
  const images = files
    .filter((file) => /\.(jpg|png)$/.test(file))
    .sort((a, b) => {
      const aTime = fs.statSync(path.join(imageDir, a)).mtime.getTime();
      const bTime = fs.statSync(path.join(imageDir, b)).mtime.getTime();
      return bTime - aTime;
    })
    .map((file) => path.join(imageDir, file));
  genImgList.push(...images);
};

loadLatestGenImg();

// 加载最新拍摄的图片路径到list中
const loadLatestCapturedImg = () => {
  const files = fs.readdirSync(cameraDir);
  const images = files
    .filter((file) => /\.(jpg|png)$/.test(file))
    .sort((a, b) => {
      const aTime = fs.statSync(path.join(cameraDir, a)).mtime.getTime();
      const bTime = fs.statSync(path.join(cameraDir, b)).mtime.getTime();
      return bTime - aTime;
    })
    .map((file) => path.join(cameraDir, file));
  capturedImgList.push(...images);
};

loadLatestCapturedImg();

export const setLatestGenImg = (imgPath: string) => {
  genImgList.push(imgPath);
  latestDisplayImg = imgPath;
};

export const getLatestDisplayImg = () => {
  const img = latestDisplayImg;
  latestDisplayImg = "";
  return img;
};

export const showLatestGenImg = () => {
  if (genImgList.length !== 0) {
    latestDisplayImg = genImgList[genImgList.length - 1] || "";
    return true;
  } else {
    return false;
  }
};

export const setLatestCapturedImg = (imgPath: string) => {
  capturedImgList.push(imgPath);
};

export const getLatestCapturedImg = () => {
  return capturedImgList.length !== 0 ? capturedImgList[capturedImgList.length - 1] : "";
};

export const showLatestCapturedImg = () => {
  if (capturedImgList.length !== 0) {
    latestDisplayImg = capturedImgList[capturedImgList.length - 1] || "";
    return true;
  } else {
    return false;
  }
}
