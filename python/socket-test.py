import socket
import json
import time
import random
import datetime

HOST = '127.0.0.1'
PORT = 12345

def generate_random_data():
    status_options = ["系统运行中", "维护中", "警告", "正常"]
    battery_status = ["charging", "low", ""]
    emoji_options = ["🚀", "🛠️", "⚠️", "✅", "💡", "✨"]
    random_text_length = random.randint(10, 100)
    random_text = "".join(random.choice("这是一段随机生成的内容，包含一些中文和英文的混合。abcdefghijklmnopqrstuvwxyz ") for _ in range(random_text_length))
    test_colors = [
        0xF800,
        0x07E0,
        0x001F,
        0xFFFF,
        0x0000,
        0xFFE0,
        0xF81F,
        0x07FF,
        0x8410,
        0x4208,
        0xAF5A,
        0x1234,
        "#FF0000",# 纯红色
        "#00FF00",# 纯绿色
        "#0000FF",# 纯蓝色
        "#FFFF00",# 黄色
        "#00FFFF",# 青色
        "#FF00FF",# 品红色
        "#FFFFFF",# 白色
        "#000000",# 黑色
        "#808080",# 灰色
        "#D3D3D3",# 浅灰色
        "#A9A9A9",# 深灰色
        "#FFA500",# 橙色
        "#FFC0CB",# 粉色
        "#800080",# 紫色
        "#A52A2A",# 棕色
    ]
    scroll_speed_options = [3, 5, 7, 10]
    brightness_options = [  50, 75, 100]
    color=random.choice(test_colors)
    data = {
        "RGB": color,
        "status": random.choice(status_options),
        # "battery_color":color,
        "battery_level":random.randint(0, 99),
        "emoji": random.choice(emoji_options),
        # "text": ,
        "scroll_speed": random.choice(scroll_speed_options),
        "brightness": random.choice(brightness_options),
    }
    if random.random() < 0.3:
        data["text"] =f"{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')} - {random_text}"
        # data["text"] =f"{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')} "
        print("本次包含text部分")
    # data["text"] =f"{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')} - {random_text}"
    
    data["text"] =f"Press the button to start"
    return data

def main():
    last_sent_payload = None

    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            try:
                sock.connect((HOST, PORT))
                print(f"[Client] 连接到 {HOST}:{PORT}")

                while True:
                    # 接收服务器发送的数据（包括按钮按下通知）
                    try:
                        response_raw = sock.recv(4096).decode("utf-8").strip()
                        if response_raw:
                            for line in response_raw.split('\n'):
                                if line:
                                    try:
                                        response = json.loads(line)
                                        if "event" in response and response["event"] == "button_pressed":
                                            print("[Client] 收到按钮按下通知，正在更新显示内容...")
                                            new_payload = generate_random_data()
                                            json_payload = (json.dumps(new_payload) + "\n").encode("utf-8")
                                            sock.sendall(json_payload)
                                            print(f"[Client] 发送新的数据: {new_payload}")
                                            last_sent_payload = new_payload
                                            server_ack = sock.recv(1024).decode("utf-8").strip()
                                            print(f"[Client] 收到服务器确认: {server_ack}")
                                        else:
                                            print(f"[Client] 收到服务器消息: {response}")
                                    except json.JSONDecodeError:
                                        print(f"[Client] 接收到无效的 JSON 数据: {line}")
                                    except Exception as e:
                                        print(f"[Client] 处理服务器消息时发生错误: {e}")
                    except socket.timeout:
                        # 如果没有接收到数据，继续循环
                        pass
                    except ConnectionResetError:
                        print("[Client] 服务器连接已断开。")
                        break
                    except Exception as e:
                        print(f"[Client] 接收数据时发生错误: {e}")
                        break

                    time.sleep(0.1) # 稍微等待一下，避免过快的轮询

            except ConnectionRefusedError:
                print("[Client] 连接被拒绝，请确保服务器正在运行。")
            except Exception as e:
                print(f"[Client] 连接或通信过程中发生错误: {e}")
            finally:
                print("[Client] 连接已关闭")

    except KeyboardInterrupt:
        print("\n[Client] 程序已停止")

if __name__ == "__main__":
    main()