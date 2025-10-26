
export const genImgList: string[] = []

let latestGenImg = ''

export const setLatestGenImg = (imgPath: string) => {
  latestGenImg = imgPath
}

export const getLatestGenImg = () => {
  const img = latestGenImg
  latestGenImg = ''
  return img
}

