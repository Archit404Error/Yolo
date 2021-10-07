from flask import Flask, jsonify, request
import mysql.connector
import requests

app = Flask(__name__)

mydb = mysql.connector.connect(
  host="sql5.freesqldatabase.com",
  user="sql5432499",
  password="Lp5Tw8l2GR",
  database="sql5432499",
  autocommit = True
 )

cursor = mydb.cursor()

def exec_sql(sql):
    cursor.execute(sql)
    return cursor.fetchall()

@app.route('/query')
def queryDB():
    res = exec_sql("SELECT * FROM Events")
    res_arr = []
    for val in res:
        res_arr.append(val)
    return jsonify(res_arr)

@app.route('/queryId')
def idRes():
    return jsonify(exec_sql("SELECT COUNT(id) FROM Events")[0][0])

@app.route('/addEvent')
def createEvent():
    params = list(request.args)
    sql = "INSERT into Events(image, title, description, location, other) VALUES ({}, {}, {}, {}, {})".format(params[0], params[1], params[2], params[3], params[4])
    cursor.execute(sql)
    chat_sql = "INSERT INTO Chats(Event, Messages, Members) VALUES ({}, {}, {})".format(params[1], "Server: Chat Created", "Archit")
    return jsonify(True)

@app.route('/getChats')
def returnChats():
    res = exec_sql('SELECT * FROM Chats WHERE id={}'.format(list(request.args)[0]))
    res_arr = []
    for val in res:
        res_arr.append(val)
    return jsonify(res_arr[0])

@app.route('/sendMessage')
def sendMess():
    params = list(request.args)
    message = params[0]
    sender = params[1]
    chat = params[2]
    old_mess = exec_sql("SELECT Messages FROM Chats WHERE id=" + chat)[0][0]
    print(old_mess)
    to_add = old_mess + "\n" + sender + ": " + message
    cursor.execute("UPDATE Chats SET Messages=\'" + to_add + "\' WHERE id=" + chat)
    return jsonify("OK")

@app.route('/updateEventPreference')
def changeEvent():
    params = list(request.args)
    user = params[0]
    operation = params[1]
    initial_state = params[2]
    event_id = params[3]

    initial_list = list(exec_sql("SELECT " + initial_state + "Events from Users WHERE Name=\'" + user + "\'")[0])
    initial_list[0] = initial_list[0][:-1]
    initial_list[len(initial_list) - 1] = initial_list[len(initial_list) - 1][1:]
    print(initial_list)
    initial_list.remove(str(event_id))

    cursor.execute("SELECT " + operation + "Events from Users WHERE Name=\'" + user + "\'")
    mutated_list = list(cursor.fetchall()[0])
    mutated_list.append(str(event_id))

    initial_list = str(initial_list.join(', '))
    mutated_list = str(mutated_list.join(', '))

    print(initial_list)
    print(mutated_list)
    return jsonify("OK")

@app.route('/getUser')
def get_user():
    params = list(request.args)
    id = params[0]
    res = list(exec_sql("SELECT * FROM Users WHERE id=" + id))[0]
    return jsonify(res)


@app.route('/auth')
def login():
    params = list(request.args)
    params = list(request.args)
    username = params[0]
    password = params[1]

    res = list(exec_sql("SELECT * FROM Users WHERE Username=\'{}\' AND Password=\'{}\'".format(username, password)))

    if len(res) == 0:
        #False success treated as register
        return jsonify(success = False)
    return jsonify(success = True, user_data = res[0])

@app.route('/addUser')
def insert_user():
    params = list(request.args)
    print(params)
    name = params[0]
    username = params[1]
    password = params[2]
    photo = params[3]

    with open(photo, 'rb') as file:
        binary_data = file.read()

    cursor.execute("INSERT INTO Users(Id, Username, Password, Name, RejectedEvents, AcceptedEvents, PendingEvents, photo) VALUES NULL, {}, {}, {}, \'\', \'\', \'\', {})".format(username, password, name, binary_data))

if __name__ == "__main__":
    app.run(debug=True)
